import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createSwingTradingRepository } from '@app/db';
import { SwingBitgetService, toBitgetGranularity } from './bitget.service';
import { UtBotStrategyService } from './utbot-strategy.service';
import { SwingExecutorService, PARTIAL_TP_PCT } from './swing-executor.service';
import { pullbackEnabledFor, evaluateAddOn } from './pullback-addon';
import { SWING_PAIRS, type SwingPair } from './swing-pairs';

/**
 * Swing trading orchestrator — UTBot trend stop-and-reverse on candle close.
 *
 * Trades a hardcoded list of robust, backtested pairs (`swing-pairs.ts`), each with
 * its own per-pair timeframe + keyValue and an independent position book. The cron
 * fires every 4h-close and scans every pair; pairs on a daily timeframe simply act
 * on the 00:01 run and no-op the intraday ones.
 *
 * For each pair, on its closed candle:
 *   0. keyValue comes from the pair config (per backtest optimum, per coin).
 *   1. Fetch candles, drop the in-progress last one → evaluate UTBot trend.
 *   2. Compare the trend to the current open position(s).
 *      - no position        → open a BASE leg in the trend direction.
 *      - position == trend   → keep; trail the UTBot stop on every leg, run the partial
 *        take-profit / breakeven rule (see below), then (only when kv is gated for it)
 *        maybe fire a PULLBACK scale-in toward the line.
 *      - position != trend   → FLIP: close ALL legs at the candle close, open the reverse.
 *
 * Partial take-profit + breakeven (every leg): once price has run +5% (PARTIAL_TP_PCT)
 * from the leg's entry, close half the leg, bank the realized P&L, and ratchet the stop
 * to breakeven (entry). The remaining half rides the UTBot trail (stop floored at entry)
 * and exits either on the trend flip or at breakeven if a candle closes back through entry
 * before the UTBot line has trailed past it. A breakeven stop-out of the BASE leg leaves
 * the book flat for that candle; the next aligned close re-opens a fresh BASE.
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
    // symbol/timeframe/keyValue are per-pair now (see swing-pairs.ts); only the
    // risk/execution knobs are global and shared across every pair.
    const globals = {
      atrPeriod: settings.atrPeriod,
      riskPerTrade: settings.riskPerTrade,
      leverage: settings.leverage,
      mode: settings.mode,
    };

    for (const pair of SWING_PAIRS) {
      try {
        await this.scanPair(pair, globals);
      } catch (err) {
        this.logger.error(`Swing scan failed for ${pair.symbol} ${pair.timeframe}: ${this.errMsg(err)}`);
      }
    }
  }

  /** Scan a single pair: evaluate UTBot trend and open / flip / scale-in its position book. */
  private async scanPair(
    pair: SwingPair,
    globals: { atrPeriod: number; riskPerTrade: number; leverage: number; mode: string },
  ): Promise<void> {
    const { symbol, timeframe, keyValue } = pair;
    const { atrPeriod, riskPerTrade, leverage, mode } = globals;

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

    // Aligned with the trend → manage each open leg:
    //   1. Trail the stop on the UTBot line, but never below breakeven once half is banked.
    //   2. At +PARTIAL_TP_PCT from entry, close half the leg and ratchet the stop to entry.
    //   3. After the partial, stop the runner out at breakeven if a candle closes back
    //      through entry before the UTBot line has trailed past it.
    let baseLegClosed = false;
    for (const leg of legs) {
      // Trailing stop = UTBot line, floored at breakeven (entry) once the partial fired.
      const trailStop = leg.breakEvenMoved
        ? (desiredDir === 'LONG'
            ? Math.max(leg.entryPrice, evalResult.stop)
            : Math.min(leg.entryPrice, evalResult.stop))
        : evalResult.stop;
      await this.executor.syncStop(leg.id, trailStop);

      // Breakeven stop-out for the runner: price came back to entry after the partial.
      if (leg.breakEvenMoved) {
        const backToEntry = desiredDir === 'LONG'
          ? evalResult.close <= leg.entryPrice
          : evalResult.close >= leg.entryPrice;
        if (backToEntry) {
          this.logger.log(`Swing ${symbol}: runner hit breakeven after partial → closing leg ${leg.legKind}`);
          await this.executor.closePosition(leg, leg.entryPrice, 'breakeven');
          if (leg.legKind === 'BASE') baseLegClosed = true;
          continue;
        }
      }

      // Partial take-profit: once price has run +PARTIAL_TP_PCT from entry, bank half.
      if (!leg.partialClosed) {
        const gainPct = desiredDir === 'LONG'
          ? (evalResult.close - leg.entryPrice) / leg.entryPrice
          : (leg.entryPrice - evalResult.close) / leg.entryPrice;
        if (gainPct >= PARTIAL_TP_PCT) {
          await this.executor.takePartialProfit(leg, evalResult.close);
        }
      }
    }
    this.logger.debug(`Swing ${symbol}: trend ${evalResult.trend} unchanged, managed ${legs.length} leg(s)`);

    // If the BASE leg was stopped out at breakeven, leave the book flat for this candle —
    // the next aligned close re-opens a fresh BASE (re-entry on trend continuation).
    if (baseLegClosed) return;

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
