import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createSwingTradingRepository } from '@app/db';
import { SwingBitgetService, toBitgetGranularity } from './bitget.service';
import { UtBotStrategyService } from './utbot-strategy.service';
import { SwingExecutorService } from './swing-executor.service';
import { resolveKeyValue } from './utbot-kv-table';
import { pullbackEnabledFor, evaluateAddOn } from './pullback-addon';

/**
 * Swing trading orchestrator — UTBot trend stop-and-reverse on candle close.
 *
 * On each closed candle of the configured timeframe (default ETHUSDT 4h):
 *   0. Resolve keyValue: settings.keyValue > 0 is an explicit override; <= 0 ("auto")
 *      looks up the per-symbol/timeframe optimum in `utbot-kv-table.ts`.
 *   1. Fetch candles, drop the in-progress last one → evaluate UTBot trend.
 *   2. Compare the trend to the current open position(s).
 *      - no position        → open a BASE leg in the trend direction.
 *      - position == trend   → keep; sync the trailing UTBot stop on every leg, then
 *        (only when kv is gated for it) maybe fire a PULLBACK scale-in toward the line.
 *      - position != trend   → FLIP: close ALL legs at the candle close, open the reverse.
 *
 * Pullback add-on (gated to kv=4, see `pullback-addon.ts`): while aligned with the trend,
 * when the close returns within 1% of the UTBot line, open one more leg in the trend
 * direction; re-arm only after price moves >1% away; max 3 adds per trend leg.
 *
 * Idempotent within a candle: a re-run sees the position already matching the trend; it
 * re-syncs the stop and re-evaluates the (deterministic) add-on rule with no extra entry.
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
    const { symbol, timeframe, atrPeriod, riskPerTrade, leverage, mode } = settings;

    // Resolve the keyValue to trade with: a positive settings.keyValue is an explicit
    // override; otherwise (<= 0 = "auto") look up the per-symbol/timeframe optimum.
    const resolved = resolveKeyValue(symbol, timeframe, settings.keyValue);
    const keyValue = resolved.keyValue;
    if (resolved.source !== 'settings') {
      this.logger.debug(
        `Swing ${symbol} ${timeframe}: auto keyValue=${keyValue} (source: ${resolved.source})`,
      );
    }

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
    const legs = await this.repo.findActiveSignals(symbol); // ordered by detectedAt asc
    const baseLeg = legs.find((l) => l.legKind === 'BASE') ?? legs[0] ?? null;

    const openBase = () =>
      this.executor.openPosition({
        symbol, timeframe, direction: desiredDir, legKind: 'BASE',
        entryPrice: evalResult.close, stopLevel: evalResult.stop,
        keyValue, atrPeriod, riskPerTrade, leverage, mode, atr: evalResult.atr,
      });

    // No open position → open a BASE leg in the trend direction (first entry).
    if (!baseLeg) {
      await openBase();
      return;
    }

    // Trend flipped → close ALL open legs (base + adds) and reverse at the candle close.
    if (baseLeg.direction !== desiredDir) {
      this.logger.log(`Swing ${symbol}: trend flipped to ${evalResult.trend} → closing ${legs.length} leg(s) and reversing`);
      for (const leg of legs) {
        await this.executor.closePosition(leg, evalResult.close);
      }
      await openBase();
      return;
    }

    // Aligned with the trend → sync the trailing stop on every open leg.
    for (const leg of legs) {
      await this.executor.syncStop(leg.id, evalResult.stop);
    }
    this.logger.debug(`Swing ${symbol}: trend ${evalResult.trend} unchanged, stop synced ${evalResult.stop.toFixed(2)} on ${legs.length} leg(s)`);

    // Pullback scale-in (gated to clean-trend keyValue only).
    if (!pullbackEnabledFor(keyValue)) return;

    const addsThisTrend = legs.filter((l) => l.legKind === 'ADD').length;
    const action = evaluateAddOn({
      close: evalResult.close,
      line: evalResult.stop,
      armed: baseLeg.pullbackArmed,
      addsThisTrend,
    });

    if (action === 'rearm') {
      // Price pushed >band away from the line → arm for the next add.
      if (!baseLeg.pullbackArmed) await this.repo.setPullbackArmed(baseLeg.id, true);
    } else if (action === 'add') {
      this.logger.log(`Swing ${symbol}: pullback add-on (${addsThisTrend + 1}/3) → scale-in ${desiredDir} @ ${evalResult.close}`);
      await this.executor.openPosition({
        symbol, timeframe, direction: desiredDir, legKind: 'ADD',
        entryPrice: evalResult.close, stopLevel: evalResult.stop,
        keyValue, atrPeriod, riskPerTrade, leverage, mode, atr: evalResult.atr,
      });
      await this.repo.setPullbackArmed(baseLeg.id, false); // must move away again before next add
    }
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
