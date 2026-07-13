import { scanChartPatterns } from '@app/core';
import type { Candle, PatternKind, PatternMatch } from '@app/core';

import type { IBackTestStrategy } from './strategy.interface';
import type { StrategyContext, TradeSignal, TradeChartSnapshot } from '../types/back-test.types';

// ── Chart Pattern Breakout Strategy ──────────────────────────────────────────
//
// Enters on the candle that CLOSES beyond the neckline of a FORMING pattern:
//   • Double Bottom / Inverse H&S  → long when close crosses UP through neckline
//   • Double Top / H&S             → short when close crosses DOWN through neckline
//
// SL = pattern structural stop (below the lowest bottom / above the highest top).
// TP = measured-move target (pattern height projected from neckline).
// Breakeven disabled — the wide initial risk already represents the pattern height;
// moving SL to entry too early invalidates the trade premise.
//
// Param `patterns` (string[]) controls which pattern kinds are active.
// Default: all four patterns.

const ALL: PatternKind[] = ['double_bottom', 'double_top', 'head_shoulders', 'inverse_head_shoulders'];

export class ChartPatternStrategy implements IBackTestStrategy {
  readonly name = 'chart-pattern';
  readonly description =
    'Chart Pattern Breakout (any timeframe): enters long/short on the candle that closes ' +
    'through the neckline of a freshly-formed Double Bottom, Double Top, Inverse H&S, or H&S. ' +
    'SL = structural stop below/above the pattern; TP = measured-move target. ' +
    'Select specific patterns via the "Patterns" param.';
  readonly defaultTimeframe = '1d';
  readonly disableBreakeven = true;

  evaluate(ctx: StrategyContext): TradeSignal | null {
    if (ctx.candles.length < 62) return null;

    const prev = ctx.candles[ctx.candles.length - 2];
    if (!prev) return null;

    const patterns = (ctx.params['patterns'] as PatternKind[] | undefined) ?? ALL;
    if (patterns.length === 0) return null;

    const series = {
      highs: ctx.candles.map((c) => c.high),
      lows: ctx.candles.map((c) => c.low),
      closes: ctx.candles.map((c) => c.close),
    };

    const matches = scanChartPatterns(series, patterns);

    for (const match of matches) {
      // Only enter on forming patterns whose neckline is crossed THIS candle.
      // Confirmed patterns already broke out — entering them is chasing.
      if (match.status !== 'forming') continue;

      const { neckline, target, stop, direction } = match;

      const didBreakBullish = direction === 'bullish' && prev.close < neckline && ctx.current.close > neckline;
      const didBreakBearish = direction === 'bearish' && prev.close > neckline && ctx.current.close < neckline;

      if (didBreakBullish || didBreakBearish) {
        return {
          direction: didBreakBullish ? 'long' : 'short',
          entryPrice: ctx.current.close,
          stopLoss: stop,
          takeProfit: target,
          chartSnapshot: this.buildSnapshot(ctx.candles, match),
        };
      }
    }

    return null;
  }

  private buildSnapshot(candles: Candle[], match: PatternMatch): TradeChartSnapshot {
    const pivotIdxs = match.pivots.map((p) => p.idx);
    const sliceStart = Math.max(0, Math.min(...pivotIdxs) - 6);
    const slice = candles.slice(sliceStart); // through last (entry) candle
    return {
      opens:     slice.map((c) => c.open),
      highs:     slice.map((c) => c.high),
      lows:      slice.map((c) => c.low),
      closes:    slice.map((c) => c.close),
      pivots:    match.pivots.map((p) => ({ idx: p.idx - sliceStart, price: p.price, role: p.role })),
      neckline:  match.neckline,
      target:    match.target,
      stop:      match.stop,
      direction: match.direction,
      pattern:   match.pattern,
    };
  }
}

export default ChartPatternStrategy;
