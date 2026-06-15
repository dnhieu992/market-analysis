import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createSwingTradingRepository } from '@app/db';
import { SwingBitgetService, toBitgetGranularity } from './bitget.service';
import { UtBotStrategyService } from './utbot-strategy.service';
import { SwingExecutorService } from './swing-executor.service';

/**
 * Swing trading orchestrator — UTBot trend stop-and-reverse on candle close.
 *
 * On each closed candle of the configured timeframe (default ETHUSDT 4h, kv=2):
 *   1. Fetch candles, drop the in-progress last one → evaluate UTBot trend.
 *   2. Compare the trend to the current open position.
 *      - no position        → open in the trend direction.
 *      - position == trend   → keep; sync the trailing UTBot stop for display.
 *      - position != trend   → FLIP: close at the candle close, open the reverse.
 *
 * Idempotent within a candle: a re-run sees the position already matching the
 * trend and does nothing.
 */
@Injectable()
export class SwingTradingService {
  private readonly logger = new Logger(SwingTradingService.name);
  private readonly repo = createSwingTradingRepository();
  private scanning = false;

  constructor(
    private readonly bitget: SwingBitgetService,
    private readonly strategy: UtBotStrategyService,
    private readonly executor: SwingExecutorService,
  ) {}

  // Run shortly after each 4H candle close (00:01, 04:01, 08:01, … UTC).
  // The cron evaluates whatever timeframe is configured; for a daily timeframe
  // the 00:01 run is the relevant one, intraday runs are cheap no-ops.
  @Cron('0 1 */4 * * *', { timeZone: 'UTC' })
  async cronScan(): Promise<void> {
    await this.runScan('cron-candle-close');
  }

  async runScan(trigger: string): Promise<void> {
    if (this.scanning) {
      this.logger.debug(`Swing scan already in progress — skipping (${trigger})`);
      return;
    }
    this.scanning = true;
    try {
      await this.scan();
    } catch (err) {
      this.logger.error(`Swing scan failed (${trigger}): ${this.errMsg(err)}`);
    } finally {
      this.scanning = false;
    }
  }

  async scan(): Promise<void> {
    const settings = await this.repo.getSettings();
    const { symbol, timeframe, atrPeriod, keyValue, riskPerTrade, leverage, mode } = settings;

    const granularity = toBitgetGranularity(timeframe);
    const candles = await this.bitget.fetchCandles(symbol, granularity, 300);
    if (candles.length < atrPeriod + 3) {
      this.logger.warn(`Not enough candles for ${symbol} ${timeframe} swing scan (${candles.length})`);
      return;
    }

    // Drop the in-progress last candle so we only act on a CONFIRMED close.
    const closed = candles.slice(0, -1);
    const evalResult = this.strategy.evaluate(closed, atrPeriod, keyValue);
    if (!evalResult) {
      this.logger.warn('UTBot evaluation returned null');
      return;
    }

    const desiredDir: 'LONG' | 'SHORT' = evalResult.trend === 'bull' ? 'LONG' : 'SHORT';
    const open = await this.repo.findActiveSignals(symbol);
    const current = open[0] ?? null;

    // No open position → open in the trend direction (first entry).
    if (!current) {
      await this.executor.openPosition({
        symbol, timeframe, direction: desiredDir,
        entryPrice: evalResult.close, stopLevel: evalResult.stop,
        keyValue, atrPeriod, riskPerTrade, leverage, mode, atr: evalResult.atr,
      });
      return;
    }

    // Position already aligned with the trend → just sync the trailing stop.
    if (current.direction === desiredDir) {
      await this.executor.syncStop(current.id, evalResult.stop);
      this.logger.debug(`Swing ${symbol}: trend ${evalResult.trend} unchanged, stop synced ${evalResult.stop.toFixed(2)}`);
      return;
    }

    // Trend flipped → close current and reverse at the candle close.
    this.logger.log(`Swing ${symbol}: trend flipped to ${evalResult.trend} → reversing`);
    await this.executor.closePosition(current, evalResult.close);
    await this.executor.openPosition({
      symbol, timeframe, direction: desiredDir,
      entryPrice: evalResult.close, stopLevel: evalResult.stop,
      keyValue, atrPeriod, riskPerTrade, leverage, mode, atr: evalResult.atr,
    });
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
