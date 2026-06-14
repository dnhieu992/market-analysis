import { calculateAtr } from '@app/core';
import type { Candle } from '@app/core';

import type { IBackTestStrategy } from './strategy.interface';
import type { StrategyContext, TradeSignal } from '../types/back-test.types';

// ── Defaults (overridable via ctx.params) ──────────────────────────────────────
const ST_PERIOD = 10;          // Supertrend ATR period (entry TF + HTF)
const ST_MULTIPLIER = 3.0;     // Supertrend ATR multiplier
const ATR_PERIOD = 14;         // ATR used to size SL/TP
const SL_ATR_MULT = 1.5;       // SL distance = SL_ATR_MULT × ATR
const RR = 1.2;                // TP distance = RR × SL distance (matches original 1:1.2)
const NO_ENTRY_HOUR_UTC = 15;  // no new entries from this UTC hour onward (matches original)

// ── Supertrend direction (Wilder RMA ATR) ──────────────────────────────────────
function supertrendDirection(candles: Candle[], period: number, multiplier: number): 'bullish' | 'bearish' {
  if (candles.length < period + 1) return 'bullish';

  const trs: number[] = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1]!.close;
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  });

  const atrs: number[] = new Array(candles.length).fill(0);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += trs[i]!;
  atrs[period - 1] = sum / period;
  for (let i = period; i < candles.length; i++) {
    atrs[i] = (atrs[i - 1]! * (period - 1) + trs[i]!) / period;
  }

  const upper: number[] = new Array(candles.length).fill(0);
  const lower: number[] = new Array(candles.length).fill(0);
  const dir: ('bullish' | 'bearish')[] = new Array(candles.length).fill('bullish');

  for (let i = period - 1; i < candles.length; i++) {
    const hl2 = (candles[i]!.high + candles[i]!.low) / 2;
    const basicUpper = hl2 + multiplier * atrs[i]!;
    const basicLower = hl2 - multiplier * atrs[i]!;

    if (i === period - 1) {
      upper[i] = basicUpper;
      lower[i] = basicLower;
      dir[i] = 'bullish';
      continue;
    }

    const prevClose = candles[i - 1]!.close;
    upper[i] = basicUpper < upper[i - 1]! || prevClose > upper[i - 1]! ? basicUpper : upper[i - 1]!;
    lower[i] = basicLower > lower[i - 1]! || prevClose < lower[i - 1]! ? basicLower : lower[i - 1]!;

    if (dir[i - 1] === 'bearish' && candles[i]!.close > upper[i]!) dir[i] = 'bullish';
    else if (dir[i - 1] === 'bullish' && candles[i]!.close < lower[i]!) dir[i] = 'bearish';
    else dir[i] = dir[i - 1]!;
  }

  return dir[candles.length - 1] ?? 'bullish';
}

// ── Engulfing patterns (same definition as the original strategy) ───────────────
type RawCandle = { open: number; close: number };

function isBullishEngulfing(prev: RawCandle, cur: RawCandle): boolean {
  const prevBearish = prev.close < prev.open;
  const curBullish = cur.close > cur.open;
  const engulfs = cur.open <= prev.close && cur.close >= prev.open;
  const strongBody = Math.abs(cur.open - cur.close) > Math.abs(prev.open - prev.close) * 1.1;
  return prevBearish && curBullish && engulfs && strongBody;
}

function isBearishEngulfing(prev: RawCandle, cur: RawCandle): boolean {
  const prevBullish = prev.close > prev.open;
  const curBearish = cur.close < cur.open;
  const engulfs = cur.open >= prev.close && cur.close <= prev.open;
  const strongBody = Math.abs(cur.open - cur.close) > Math.abs(prev.open - prev.close) * 1.1;
  return prevBullish && curBearish && engulfs && strongBody;
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/**
 * supertrend-engulfing-mtf — improvement of `supertrend-engulfing` combining:
 *   (1) ATR-based SL/TP that scales with volatility/price level, instead of the
 *       original fixed $500/$600 absolute stops.
 *   (3) 4H Supertrend trend filter (multi-timeframe): only take a long when the 4H
 *       Supertrend is bullish, only take a short when it is bearish.
 * Everything else (M30 entry TF, Supertrend(10,3) direction, engulfing trigger,
 * 15:00–00:00 UTC time filter, 1:1.2 R:R) is kept identical for a clean A/B.
 */
export class SupertrendEngulfingMtfStrategy implements IBackTestStrategy {
  readonly name = 'supertrend-engulfing-mtf';
  readonly description =
    'Supertrend-engulfing + ATR-based SL/TP (scales with volatility) + 4H Supertrend trend filter. M30 entry, Supertrend(10,3), 1:1.2 R:R, no entries 15:00–00:00 UTC.';
  readonly defaultTimeframe = 'M30';
  readonly forcedTimeframe = 'M30';
  readonly htfTimeframes = ['4h'];

  evaluate(ctx: StrategyContext): TradeSignal | null {
    const { candles, current, params, htfCandles } = ctx;

    const stPeriod = num(params.stPeriod, ST_PERIOD);
    const stMult = num(params.stMultiplier, ST_MULTIPLIER);
    const atrPeriod = num(params.atrPeriod, ATR_PERIOD);
    const slAtrMult = num(params.slAtrMult, SL_ATR_MULT);
    const rr = num(params.rr, RR);

    if (candles.length < Math.max(stPeriod, atrPeriod) + 2) return null;

    // ── Time filter: no new orders from 15:00 to 00:00 UTC ───────────────────────
    if (current.openTime && current.openTime.getUTCHours() >= NO_ENTRY_HOUR_UTC) return null;

    const prev = candles[candles.length - 2]!;
    const trend = supertrendDirection(candles, stPeriod, stMult);

    // ── (3) 4H Supertrend trend filter ───────────────────────────────────────────
    // Slice HTF candles to those at/before the current bar to avoid lookahead.
    const h4 = (htfCandles['4h'] ?? []).filter(
      (c) => c.openTime != null && current.openTime != null && c.openTime <= current.openTime
    );
    if (h4.length < stPeriod + 1) return null; // not enough HTF history yet
    const h4Trend = supertrendDirection(h4, stPeriod, stMult);

    // ── (1) ATR-based SL/TP ──────────────────────────────────────────────────────
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);
    const atr = calculateAtr(highs, lows, closes, atrPeriod);
    if (atr <= 0) return null;

    const slDist = slAtrMult * atr;
    const tpDist = rr * slDist;
    const entry = current.close;

    // ── Long: M30 + 4H both bullish + bullish engulfing ──────────────────────────
    if (trend === 'bullish' && h4Trend === 'bullish' && isBullishEngulfing(prev, current)) {
      return {
        direction: 'long',
        entryPrice: entry,
        stopLoss: entry - slDist,
        takeProfit: entry + tpDist
      };
    }

    // ── Short: M30 + 4H both bearish + bearish engulfing ─────────────────────────
    if (trend === 'bearish' && h4Trend === 'bearish' && isBearishEngulfing(prev, current)) {
      return {
        direction: 'short',
        entryPrice: entry,
        stopLoss: entry + slDist,
        takeProfit: entry - tpDist
      };
    }

    return null;
  }
}

export default SupertrendEngulfingMtfStrategy;
