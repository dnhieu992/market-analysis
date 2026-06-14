import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createDayTradingRepository } from '@app/db';
import { BitgetService } from './bitget.service';
import { BitgetWebSocketService } from './bitget-websocket.service';

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
  ) {}

  onModuleInit(): void {
    // Real-time path: evaluate open signals on EVERY WS price tick so TP/SL is
    // detected as close to the actual touch as the public feed allows. We record
    // the real observed price as the close (no idealised fill) — this mirrors a
    // market exit and surfaces the true gap vs the TP/SL level for review.
    this.ws.on('price', (price: number) => {
      void this.onTick(price);
    });
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
            .then(() => this.logger.log(`Signal ${id} → break-even @ +1R (SL ${entryPrice})`))
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
        await this.repo.updateSignalResult(id, {
          status: hit,
          closedPrice: price,
          closedAt: new Date(),
          pnlUsd,
        });
        this.logger.log(
          `Signal ${id} closed: ${hit} @ ${price} → $${pnlUsd.toFixed(2)} (entry ${entryPrice}, SL ${stopLoss}, TP ${takeProfit})`,
        );
      } catch (err) {
        // Close write failed — re-arm so the next tick/cron retries this signal.
        this.logger.error(`Failed to close signal ${id}: ${this.errMsg(err)}`);
        this.cacheAt = 0;
      } finally {
        this.closing.delete(id);
      }
    }
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
