import type { Candle } from '@app/core';

import type { IBackTestStrategy } from './strategy.interface';
import type { StrategyContext, TradeSignal } from '../types/back-test.types';

const ST_PERIOD = 10;
const ST_MULTIPLIER = 3.0;
const SL_STEPS = 500;
const TP_STEPS = 600; // 1:1.2 R:R

// ── Supertrend ───────────────────────────────────────────────────────────────
// Uses Wilder's RMA for ATR (standard for supertrend)

function calculateSupertrendDirection(candles: Candle[]): 'bullish' | 'bearish' {
  if (candles.length < ST_PERIOD + 1) return 'bullish';

  // True ranges
  const trs: number[] = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1]!.close;
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  });

  // RMA (Wilder's smoothing)
  const atrs: number[] = new Array(candles.length).fill(0);
  let sum = 0;
  for (let i = 0; i < ST_PERIOD; i++) sum += trs[i]!;
  atrs[ST_PERIOD - 1] = sum / ST_PERIOD;
  for (let i = ST_PERIOD; i < candles.length; i++) {
    atrs[i] = (atrs[i - 1]! * (ST_PERIOD - 1) + trs[i]!) / ST_PERIOD;
  }

  // Band calculation and direction
  const upperBands: number[] = new Array(candles.length).fill(0);
  const lowerBands: number[] = new Array(candles.length).fill(0);
  const directions: ('bullish' | 'bearish')[] = new Array(candles.length).fill('bullish');

  for (let i = ST_PERIOD - 1; i < candles.length; i++) {
    const hl2 = (candles[i]!.high + candles[i]!.low) / 2;
    const atr = atrs[i]!;
    const basicUpper = hl2 + ST_MULTIPLIER * atr;
    const basicLower = hl2 - ST_MULTIPLIER * atr;

    if (i === ST_PERIOD - 1) {
      upperBands[i] = basicUpper;
      lowerBands[i] = basicLower;
      directions[i] = 'bullish';
      continue;
    }

    const prevClose = candles[i - 1]!.close;

    upperBands[i] =
      basicUpper < upperBands[i - 1]! || prevClose > upperBands[i - 1]!
        ? basicUpper
        : upperBands[i - 1]!;

    lowerBands[i] =
      basicLower > lowerBands[i - 1]! || prevClose < lowerBands[i - 1]!
        ? basicLower
        : lowerBands[i - 1]!;

    if (directions[i - 1] === 'bearish' && candles[i]!.close > upperBands[i]!) {
      directions[i] = 'bullish';
    } else if (directions[i - 1] === 'bullish' && candles[i]!.close < lowerBands[i]!) {
      directions[i] = 'bearish';
    } else {
      directions[i] = directions[i - 1]!;
    }
  }

  return directions[candles.length - 1] ?? 'bullish';
}

// ── Engulfing patterns ───────────────────────────────────────────────────────

type RawCandle = { open: number; close: number };

function isBullishEngulfing(prev: RawCandle, current: RawCandle): boolean {
  const prevBearish = prev.close < prev.open;
  const currentBullish = current.close > current.open;
  const engulfs = current.open <= prev.close && current.close >= prev.open;
  const prevBody = Math.abs(prev.open - prev.close);
  const currentBody = Math.abs(current.open - current.close);
  const strongBody = currentBody > prevBody * 1.1;
  return prevBearish && currentBullish && engulfs && strongBody;
}

function isBearishEngulfing(prev: RawCandle, current: RawCandle): boolean {
  const prevBullish = prev.close > prev.open;
  const currentBearish = current.close < current.open;
  const engulfs = current.open >= prev.close && current.close <= prev.open;
  const prevBody = Math.abs(prev.open - prev.close);
  const currentBody = Math.abs(current.open - current.close);
  const strongBody = currentBody > prevBody * 1.1;
  return prevBullish && currentBearish && engulfs && strongBody;
}

// ── Strategy ─────────────────────────────────────────────────────────────────

export class SupertrendEngulfingStrategy implements IBackTestStrategy {
  readonly name = 'supertrend-engulfing';
  readonly description =
    'Enter on engulfing candle when Supertrend(10,3) confirms trend direction. SL = 500 steps, TP = 600 steps (1:1.2 R:R). No entries 15:00–00:00 UTC.';
  readonly defaultTimeframe = 'M30';
  readonly forcedTimeframe = 'M30';

  evaluate(ctx: StrategyContext): TradeSignal | null {
    if (ctx.candles.length < ST_PERIOD + 2) return null;

    const candles = ctx.candles;
    const current = ctx.current;
    const prev = candles[candles.length - 2]!;

    const trend = calculateSupertrendDirection(candles);

    // ── Time filter: no new orders from 15:00 to 00:00 UTC ───────────────────
    if (current.openTime && current.openTime.getUTCHours() >= 15) return null;

    const entry = current.close;

    // ── Long ─────────────────────────────────────────────────────────────────
    if (trend === 'bullish' && isBullishEngulfing(prev, current)) {
      return {
        direction: 'long',
        entryPrice: entry,
        stopLoss: entry - SL_STEPS,
        takeProfit: entry + TP_STEPS
      };
    }

    // ── Short ────────────────────────────────────────────────────────────────
    if (trend === 'bearish' && isBearishEngulfing(prev, current)) {
      return {
        direction: 'short',
        entryPrice: entry,
        stopLoss: entry + SL_STEPS,
        takeProfit: entry - TP_STEPS
      };
    }

    return null;
  }
}

export default SupertrendEngulfingStrategy;
