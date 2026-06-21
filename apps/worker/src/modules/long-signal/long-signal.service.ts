import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createLongSignalRepository } from '@app/db';
import { LongSignalBitgetService } from './bitget.service';
import { LongSignalTradeService } from './long-signal-trade.service';
import { LongSignalExecutorService } from './long-signal-executor.service';
import { evaluateUtBot } from './utbot';

type ActiveSignal = Awaited<
  ReturnType<ReturnType<typeof createLongSignalRepository>['findActiveSignals']>
>[number];

/**
 * Long Signal orchestrator — LONG-only intraday FOMO gated by the M30 UTBot trend.
 *
 * Daily flow (per coin in the configured basket):
 *   - ENTRY (entryHour UTC): if the last CLOSED M30 candle's UTBot trend is bull,
 *     open a LONG (fixed notional) with a +tpPct TP and a wide catastrophe SL.
 *     Bear → skip. One entry per coin per day (idempotent on re-run).
 *   - FORCE-CLOSE (exitHour UTC): market-close any still-open position.
 *   - In between: the +tpPct TP exits the trade. PAPER is checked each minute
 *     against the live price; LIVE is reconciled against the real broker fill.
 *
 * Backtest basis: scripts/run-long-fomo-m30utbot-filter-backtest.ts
 *   (POL/XRP/SOL/TAO, entry 00:00 UTC, exit 08:00 UTC, TP +2%, kv=1).
 */
@Injectable()
export class LongSignalService {
  private readonly logger = new Logger(LongSignalService.name);
  private readonly repo = createLongSignalRepository();
  private busy = false;

  constructor(
    private readonly bitget: LongSignalBitgetService,
    private readonly trade: LongSignalTradeService,
    private readonly executor: LongSignalExecutorService,
  ) {}

  /** Top of every hour — dispatch entry / force-close based on configured hours. */
  @Cron('0 0 * * * *', { timeZone: 'UTC' })
  async onHourTick(): Promise<void> {
    if (this.busy) {
      this.logger.debug('Long signal hour-tick already running — skipping');
      return;
    }
    this.busy = true;
    try {
      const settings = await this.repo.getSettings();
      const hour = new Date().getUTCHours();
      if (hour === settings.entryHour) await this.runEntry(settings);
      if (hour === settings.exitHour) await this.runForceClose();
    } catch (err) {
      this.logger.error(`Long signal hour-tick failed: ${this.errMsg(err)}`);
    } finally {
      this.busy = false;
    }
  }

  /** Per-minute monitor: PAPER TP/SL check + LIVE broker reconciliation. */
  @Cron('30 * * * * *', { timeZone: 'UTC' })
  async monitor(): Promise<void> {
    try {
      await this.checkPaper();
    } catch (err) {
      this.logger.error(`Long signal PAPER monitor failed: ${this.errMsg(err)}`);
    }
    try {
      await this.reconcileLive();
    } catch (err) {
      this.logger.error(`Long signal LIVE reconcile failed: ${this.errMsg(err)}`);
    }
  }

  // --- ENTRY -------------------------------------------------------------

  private async runEntry(settings: Awaited<ReturnType<typeof this.repo.getSettings>>): Promise<void> {
    const symbols = settings.symbols.split(',').map((s) => s.trim()).filter(Boolean);
    this.logger.log(`Long signal ENTRY scan @ ${settings.entryHour}:00 UTC for ${symbols.join(', ')}`);
    for (const symbol of symbols) {
      try {
        await this.tryEnter(symbol, settings);
      } catch (err) {
        this.logger.error(`Long signal entry failed for ${symbol}: ${this.errMsg(err)}`);
      }
    }
  }

  private async tryEnter(
    symbol: string,
    settings: Awaited<ReturnType<typeof this.repo.getSettings>>,
  ): Promise<void> {
    if (await this.repo.hasSignalToday(symbol)) {
      this.logger.debug(`Long signal ${symbol}: already has a signal today — skipping`);
      return;
    }
    const candles = await this.bitget.fetchCandles(symbol, '30m', 300);
    if (candles.length < settings.atrPeriod + 3) {
      this.logger.warn(`Long signal ${symbol}: not enough M30 candles (${candles.length})`);
      return;
    }
    // Drop the in-progress last candle → evaluate the last CONFIRMED close.
    const closed = candles.slice(0, -1);
    const evalResult = evaluateUtBot(closed, settings.atrPeriod, settings.keyValue);
    if (!evalResult) {
      this.logger.warn(`Long signal ${symbol}: UTBot evaluation returned null`);
      return;
    }
    if (evalResult.trend !== 'bull') {
      this.logger.log(`Long signal ${symbol}: M30 UTBot bear → skip (no long)`);
      return;
    }

    const price = (await this.bitget.fetchCurrentPrice(symbol)) ?? evalResult.close;
    if (!Number.isFinite(price) || price <= 0) {
      this.logger.warn(`Long signal ${symbol}: no usable entry price`);
      return;
    }
    const takeProfit = price * (1 + settings.tpPct / 100);
    const stopLoss = price * (1 - settings.catastropheStopPct / 100);
    const lineDistancePct = (Math.abs(price - evalResult.stop) / price) * 100;

    await this.executor.openLong({
      symbol,
      entryPrice: price,
      takeProfit,
      stopLoss,
      notional: settings.notional,
      leverage: settings.leverage,
      keyValue: settings.keyValue,
      atr: evalResult.atr,
      lineDistancePct,
      mode: settings.mode,
    });
  }

  // --- FORCE CLOSE -------------------------------------------------------

  private async runForceClose(): Promise<void> {
    const active = await this.repo.findActiveSignals();
    if (!active.length) return;
    this.logger.log(`Long signal FORCE-CLOSE: ${active.length} open position(s)`);
    for (const signal of active) {
      try {
        await this.forceCloseOne(signal);
      } catch (err) {
        this.logger.error(`Force-close failed for ${signal.symbol} (${signal.id}): ${this.errMsg(err)}`);
      }
    }
  }

  private async forceCloseOne(signal: ActiveSignal): Promise<void> {
    if (signal.mode === 'LIVE' && this.trade.isConfigured()) {
      const pos = await this.trade.getLongPosition(signal.symbol);
      if (pos && pos.size > 0) await this.trade.closeLong(signal.symbol);
      // Read the real fill; fall back to live price if the history feed lags.
      const closed = await this.trade.getClosedLong(signal.symbol, new Date(signal.detectedAt).getTime());
      const price = closed?.closeAvgPrice ?? (await this.bitget.fetchCurrentPrice(signal.symbol)) ?? signal.entryPrice;
      const pnl = closed?.netProfit ?? this.estPnl(signal, price);
      await this.recordClose(signal, 'FORCE_CLOSE', price, pnl, closed ? new Date(closed.closedAtMs) : new Date());
      return;
    }
    const price = (await this.bitget.fetchCurrentPrice(signal.symbol)) ?? signal.entryPrice;
    await this.recordClose(signal, 'FORCE_CLOSE', price, this.estPnl(signal, price), new Date());
  }

  // --- MONITOR -----------------------------------------------------------

  /** PAPER signals: close on TP/SL touch against the live price. */
  private async checkPaper(): Promise<void> {
    const active = (await this.repo.findActiveSignals()).filter((s) => s.mode !== 'LIVE');
    for (const signal of active) {
      const price = await this.bitget.fetchCurrentPrice(signal.symbol);
      if (price == null) continue;
      let hit: 'TP_HIT' | 'SL_HIT' | null = null;
      if (price >= signal.takeProfit) hit = 'TP_HIT';
      else if (price <= signal.stopLoss) hit = 'SL_HIT';
      if (!hit) continue;
      const fill = hit === 'TP_HIT' ? signal.takeProfit : signal.stopLoss;
      await this.recordClose(signal, hit, fill, this.estPnl(signal, fill), new Date());
    }
  }

  /** LIVE signals: the exchange owns TP/SL — sync the DB to the real broker state. */
  private async reconcileLive(): Promise<void> {
    if (!this.trade.isConfigured()) return;
    const live = (await this.repo.findActiveSignals()).filter((s) => s.mode === 'LIVE');
    for (const signal of live) {
      try {
        const pos = await this.trade.getLongPosition(signal.symbol);
        if (pos && pos.size > 0) continue; // still open on the exchange
        const closed = await this.trade.getClosedLong(signal.symbol, new Date(signal.detectedAt).getTime());
        if (!closed) continue; // history feed lags — leave ACTIVE for the next pass
        const hit: 'TP_HIT' | 'SL_HIT' =
          Math.abs(closed.closeAvgPrice - signal.takeProfit) <= Math.abs(closed.closeAvgPrice - signal.stopLoss)
            ? 'TP_HIT'
            : 'SL_HIT';
        await this.recordClose(signal, hit, closed.closeAvgPrice, closed.netProfit, new Date(closed.closedAtMs));
      } catch (err) {
        this.logger.warn(`Reconcile ${signal.id} failed: ${this.errMsg(err)}`);
      }
    }
  }

  // --- helpers -----------------------------------------------------------

  private estPnl(signal: ActiveSignal, price: number): number {
    const qty = signal.quantity ?? 0;
    return qty * (price - signal.entryPrice); // LONG only
  }

  private async recordClose(
    signal: ActiveSignal,
    status: 'TP_HIT' | 'SL_HIT' | 'FORCE_CLOSE',
    price: number,
    pnlUsd: number,
    closedAt: Date,
  ): Promise<void> {
    const won = await this.repo.closeActiveSignal(signal.id, { status, closedPrice: price, closedAt, pnlUsd });
    if (!won) return; // already closed by another path
    this.logger.log(`Long signal ${signal.symbol} closed: ${status} @ ${price} → $${pnlUsd.toFixed(2)}`);
    const label = status === 'TP_HIT' ? '🎯 Chốt TP' : status === 'SL_HIT' ? '🛑 Dính SL bảo hiểm' : '⏰ Đóng theo giờ';
    await this.repo
      .appendNote(signal.id, `- ${label} @ ${price.toLocaleString('en-US', { maximumFractionDigits: 6 })} · P&L $${pnlUsd.toFixed(2)}`)
      .catch(() => undefined);
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
