import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createDayTradingRepository } from '@app/db';
import { BitgetService } from './bitget.service';
import { BitgetTradeService } from './bitget-trade.service';
import { BitgetWebSocketService } from './bitget-websocket.service';
import { withRetry } from './retry.util';
import { audit } from './audit.util';

type ActiveSignal = Awaited<
  ReturnType<ReturnType<typeof createDayTradingRepository>['findActiveSignals']>
>[number];

// How long the in-memory active-signal cache is trusted before a DB refresh.
// Ticks arrive multiple times per second; this keeps DB load flat while still
// picking up a newly created signal within a few seconds.
const CACHE_TTL_MS = 5_000;

@Injectable()
export class ResultMonitorService implements OnModuleInit {
  private readonly logger = new Logger(ResultMonitorService.name);
  private readonly repo = createDayTradingRepository();

  // Cached open signals so we don't hit the DB on every WS tick.
  private active: ActiveSignal[] = [];
  private cacheAt = 0;
  private refreshing = false;
  // Signals whose close write is in flight — guards against a concurrent tick
  // closing the same signal twice while the DB update awaits.
  private readonly closing = new Set<string>();
  // Signals whose break-even move is in flight — same guard for the BE update.
  private readonly movingBE = new Set<string>();

  constructor(
    private readonly bitget: BitgetService,
    private readonly ws: BitgetWebSocketService,
    private readonly trade: BitgetTradeService,
  ) {}

  onModuleInit(): void {
    // Real-time path: evaluate open signals on EVERY WS price tick so TP/SL is
    // detected as close to the actual touch as the public feed allows. We record
    // the real observed price as the close (no idealised fill) — this mirrors a
    // market exit and surfaces the true gap vs the TP/SL level for review.
    // NOTE: this path is PAPER-only; LIVE signals are reconciled against the
    // broker (the exchange owns their preset TP/SL — see reconcileLiveSignals).
    this.ws.on('price', (price: number) => {
      void this.onTick(price);
    });

    // Startup reconciliation: in-memory state is lost on every worker restart
    // (i.e. every ./deploy.sh). Sync DB-ACTIVE LIVE signals against the real
    // Bitget position state once at boot, after a short settle delay. The
    // per-minute cron keeps it in sync thereafter.
    if (this.trade.isConfigured()) {
      setTimeout(() => void this.reconcileLiveSignals(), 5_000);
    }
  }

  /** Real-time path — runs on each WS tick against the cached active set. */
  private async onTick(price: number): Promise<void> {
    if (!Number.isFinite(price)) return;
    await this.ensureCache();
    if (!this.active.length) return;
    await this.evaluate(price);
  }

  /**
   * Fallback path — invoked by the per-minute cron. Forces a cache refresh and
   * evaluates with the freshest price available (WS if healthy, else REST), so a
   * stalled/disconnected WS feed can't silently stop TP/SL detection.
   */
  async checkActiveSignals(): Promise<void> {
    await this.refreshCache();
    if (!this.active.length) return;

    let price = this.ws.isHealthy() ? this.ws.getLatestPrice() : null;
    if (price == null) {
      price = await this.bitget.fetchCurrentPrice();
    }
    if (price == null) {
      this.logger.warn('Could not obtain price for result monitoring');
      return;
    }
    await this.evaluate(price);
  }

  private async ensureCache(): Promise<void> {
    if (Date.now() - this.cacheAt < CACHE_TTL_MS) return;
    await this.refreshCache();
  }

  private async refreshCache(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      this.active = await this.repo.findActiveSignals('BTCUSDT');
      this.cacheAt = Date.now();
    } catch (err) {
      this.logger.warn(`Failed to refresh active-signal cache: ${this.errMsg(err)}`);
    } finally {
      this.refreshing = false;
    }
  }

  /** Evaluate the cached open signals against a price; close any that touched TP/SL. */
  private async evaluate(price: number): Promise<void> {
    for (const signal of this.active) {
      if (this.closing.has(signal.id)) continue;
      // LIVE signals exit via the exchange's preset TP/SL, not a WS tick — they
      // are closed by reconcileLiveSignals() reading the real broker fill. The
      // bot-side break-even is also skipped for LIVE (it would only diverge the
      // DB stop from the exchange's actual SL order).
      if (signal.mode === 'LIVE') continue;

      const { id, direction, entryPrice, takeProfit } = signal;

      // Trade management: once price reaches +1R, move the stop to break-even.
      // Uses the ORIGINAL stop distance (still intact while breakEvenMoved=false).
      if (!signal.breakEvenMoved && !this.movingBE.has(id)) {
        const riskDist = Math.abs(entryPrice - signal.stopLoss);
        const oneR = direction === 'LONG' ? entryPrice + riskDist : entryPrice - riskDist;
        const reached = direction === 'LONG' ? price >= oneR : price <= oneR;
        if (riskDist > 0 && reached) {
          this.movingBE.add(id);
          signal.breakEvenMoved = true;       // optimistic cache update (next ticks use new SL)
          signal.stopLoss = entryPrice;
          void this.repo.moveStopToBreakEven(id, entryPrice)
            .then(() => {
              this.logger.log(`Signal ${id} → break-even @ +1R (SL ${entryPrice})`);
              audit(this.repo, this.logger, {
                action: 'BE_MOVED', signalId: id, symbol: signal.symbol,
                message: `Stop moved to break-even @ +1R (SL ${entryPrice})`,
                detail: { entryPrice, oneR, price },
              });
            })
            .catch((err) => { this.logger.error(`Failed BE move ${id}: ${this.errMsg(err)}`); this.cacheAt = 0; })
            .finally(() => this.movingBE.delete(id));
        }
      }

      const stopLoss = signal.stopLoss;   // may have just moved to break-even
      let hit: 'TP_HIT' | 'SL_HIT' | null = null;

      if (direction === 'LONG') {
        if (price >= takeProfit) hit = 'TP_HIT';
        else if (price <= stopLoss) hit = 'SL_HIT';
      } else {
        if (price <= takeProfit) hit = 'TP_HIT';
        else if (price >= stopLoss) hit = 'SL_HIT';
      }

      if (!hit) continue;

      // Claim it synchronously (before any await) so a concurrent tick can't
      // also close it: mark it closing and drop it from the active set.
      this.closing.add(id);
      this.active = this.active.filter((s) => s.id !== id);

      // Realized P&L in USD = volume × price move (signed by direction).
      // Falls back to the fixed ±risk model if volume wasn't stored.
      // NOTE: this uses the observed close `price`, not `takeProfit` — so the
      // P&L reflects real slippage/overshoot, not an idealised limit fill.
      const qty = signal.quantity;
      const priceMove = direction === 'LONG' ? price - entryPrice : entryPrice - price;
      const pnlUsd = qty != null
        ? qty * priceMove
        : (hit === 'TP_HIT' ? signal.rrRatio * signal.riskAmount : -signal.riskAmount);

      try {
        // Closing write is critical: a dropped update leaves a phantom open
        // position. Retry x3 before falling back to re-arm. `closeActiveSignal`
        // only writes while status is still ACTIVE, so it's both idempotent on
        // repeat AND race-safe against a manual close from the API process — the
        // loser of the race gets `false` and simply stops.
        const won = await withRetry(
          () => this.repo.closeActiveSignal(id, {
            status: hit,
            closedPrice: price,
            closedAt: new Date(),
            pnlUsd,
          }),
          { label: `close signal ${id}`, logger: this.logger },
        );
        if (!won) {
          this.logger.log(`Signal ${id} already closed by another path — skipping`);
        } else {
          this.logger.log(
            `Signal ${id} closed: ${hit} @ ${price} → $${pnlUsd.toFixed(2)} (entry ${entryPrice}, SL ${stopLoss}, TP ${takeProfit})`,
          );
          audit(this.repo, this.logger, {
            action: 'CLOSED', signalId: id, symbol: signal.symbol,
            message: `${hit} @ ${price} → $${pnlUsd.toFixed(2)}`,
            detail: { hit, closedPrice: price, pnlUsd, entryPrice, stopLoss, takeProfit, direction },
          });
        }
      } catch (err) {
        // Close write failed — re-arm so the next tick/cron retries this signal.
        this.logger.error(`Failed to close signal ${id}: ${this.errMsg(err)}`);
        this.cacheAt = 0;
      } finally {
        this.closing.delete(id);
      }
    }
  }

  /**
   * LIVE reconciliation — the source-of-truth sync for real positions.
   *
   * For each DB-ACTIVE LIVE signal, ask Bitget whether its position is still
   * open. If the exchange has closed it (preset TP or SL filled), read the REAL
   * fill (close price + net realized PnL after fees) and close the DB row to
   * match, classifying TP_HIT vs SL_HIT by which level the fill is nearer. This
   * is what keeps the DB in step with the broker across worker restarts and
   * replaces the WS-tick close for LIVE. Runs at startup and every minute.
   */
  async reconcileLiveSignals(): Promise<void> {
    if (!this.trade.isConfigured()) return;

    let live: ActiveSignal[];
    try {
      live = (await this.repo.findActiveSignals('BTCUSDT')).filter((s) => s.mode === 'LIVE');
    } catch (err) {
      this.logger.warn(`Reconcile: failed to load LIVE signals: ${this.errMsg(err)}`);
      return;
    }
    for (const signal of live) {
      if (this.closing.has(signal.id)) continue;
      await this.reconcileOne(signal);
    }
  }

  private async reconcileOne(signal: ActiveSignal): Promise<void> {
    const holdSide = signal.direction === 'LONG' ? 'long' : 'short';
    try {
      const pos = await this.trade.getPosition(signal.symbol, holdSide);
      if (pos && pos.size > 0) return; // still open on the exchange → leave ACTIVE

      // Exchange is flat for this side. Find the matching closed position to read
      // the real fill. If the history feed lags (null), leave it for the next
      // pass rather than guessing a close price.
      const closed = await this.trade.getClosedPosition(
        signal.symbol,
        holdSide,
        new Date(signal.detectedAt).getTime(),
      );
      if (!closed) return;

      const closePrice = closed.closeAvgPrice;
      const hit: 'TP_HIT' | 'SL_HIT' =
        Math.abs(closePrice - signal.takeProfit) <= Math.abs(closePrice - signal.stopLoss)
          ? 'TP_HIT'
          : 'SL_HIT';

      this.closing.add(signal.id);
      try {
        // Race-safe: closeActiveSignal only writes while still ACTIVE.
        const won = await this.repo.closeActiveSignal(signal.id, {
          status: hit,
          closedPrice: closePrice,
          closedAt: new Date(closed.closedAtMs),
          pnlUsd: closed.netProfit, // REAL realized PnL from the broker (after fees)
        });
        if (!won) return; // already closed by another path

        this.logger.log(
          `Reconcile: LIVE signal ${signal.id} closed ${hit} @ ${closePrice} → $${closed.netProfit.toFixed(2)} (broker fill)`,
        );
        audit(this.repo, this.logger, {
          action: 'RECONCILE_FIX',
          signalId: signal.id,
          symbol: signal.symbol,
          message: `LIVE ${hit} reconciled from broker @ ${closePrice} → $${closed.netProfit.toFixed(2)}`,
          detail: {
            hit,
            closedPrice: closePrice,
            pnlUsd: closed.netProfit,
            takeProfit: signal.takeProfit,
            stopLoss: signal.stopLoss,
            direction: signal.direction,
            source: 'broker',
          },
        });
      } finally {
        this.closing.delete(signal.id);
      }
    } catch (err) {
      this.logger.warn(`Reconcile ${signal.id} failed: ${this.errMsg(err)}`);
    }
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
