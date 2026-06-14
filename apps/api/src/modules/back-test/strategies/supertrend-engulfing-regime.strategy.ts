import { calculateAtr, calculateRsi } from '@app/core';
import type { Candle } from '@app/core';

import type { IBackTestStrategy } from './strategy.interface';
import type { StrategyContext, TradeSignal } from '../types/back-test.types';

// ── Defaults (overridable via ctx.params) ──────────────────────────────────────
const ST_PERIOD = 10;
const ST_MULTIPLIER = 3.0;
const ATR_PERIOD = 14;
const SL_ATR_MULT = 1.5;
const RR = 1.6;            // best PnL config from the rr sweep
const ADX_PERIOD = 14;
const MIN_ADX = 20;        // only trade when trend is strong → fewer chop entries
const RSI_PERIOD = 14;
const LONG_RSI_MAX = 70;   // don't long into overbought
const SHORT_RSI_MIN = 30;  // don't short into oversold
const NO_ENTRY_HOUR_UTC = 15;

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
  for (let i = period; i < candles.length; i++) atrs[i] = (atrs[i - 1]! * (period - 1) + trs[i]!) / period;

  const upper: number[] = new Array(candles.length).fill(0);
  const lower: number[] = new Array(candles.length).fill(0);
  const dir: ('bullish' | 'bearish')[] = new Array(candles.length).fill('bullish');
  for (let i = period - 1; i < candles.length; i++) {
    const hl2 = (candles[i]!.high + candles[i]!.low) / 2;
    const basicUpper = hl2 + multiplier * atrs[i]!;
    const basicLower = hl2 - multiplier * atrs[i]!;
    if (i === period - 1) { upper[i] = basicUpper; lower[i] = basicLower; dir[i] = 'bullish'; continue; }
    const prevClose = candles[i - 1]!.close;
    upper[i] = basicUpper < upper[i - 1]! || prevClose > upper[i - 1]! ? basicUpper : upper[i - 1]!;
    lower[i] = basicLower > lower[i - 1]! || prevClose < lower[i - 1]! ? basicLower : lower[i - 1]!;
    if (dir[i - 1] === 'bearish' && candles[i]!.close > upper[i]!) dir[i] = 'bullish';
    else if (dir[i - 1] === 'bullish' && candles[i]!.close < lower[i]!) dir[i] = 'bearish';
    else dir[i] = dir[i - 1]!;
  }
  return dir[candles.length - 1] ?? 'bullish';
}

// ── ADX (Wilder) — trend strength ───────────────────────────────────────────────
function calculateAdx(highs: number[], lows: number[], closes: number[], period: number): number {
  const len = closes.length;
  if (len < period * 2) return 0;
  const plusDM: number[] = [], minusDM: number[] = [], tr: number[] = [];
  for (let i = 1; i < len; i++) {
    const upMove = highs[i]! - highs[i - 1]!;
    const downMove = lows[i - 1]! - lows[i]!;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(highs[i]! - lows[i]!, Math.abs(highs[i]! - closes[i - 1]!), Math.abs(lows[i]! - closes[i - 1]!)));
  }
  let smTr = tr.slice(0, period).reduce((a, b) => a + b, 0);
  let smP = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
  let smM = minusDM.slice(0, period).reduce((a, b) => a + b, 0);
  const dx: number[] = [];
  for (let i = period; i < tr.length; i++) {
    smTr = smTr - smTr / period + tr[i]!;
    smP = smP - smP / period + plusDM[i]!;
    smM = smM - smM / period + minusDM[i]!;
    const diP = (smP / smTr) * 100, diM = (smM / smTr) * 100, s = diP + diM;
    dx.push(s === 0 ? 0 : (Math.abs(diP - diM) / s) * 100);
  }
  if (dx.length < period) return 0;
  return dx.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// ── Engulfing patterns ──────────────────────────────────────────────────────────
type RawCandle = { open: number; close: number };
function isBullishEngulfing(prev: RawCandle, cur: RawCandle): boolean {
  return prev.close < prev.open && cur.close > cur.open &&
    cur.open <= prev.close && cur.close >= prev.open &&
    Math.abs(cur.open - cur.close) > Math.abs(prev.open - prev.close) * 1.1;
}
function isBearishEngulfing(prev: RawCandle, cur: RawCandle): boolean {
  return prev.close > prev.open && cur.close < cur.open &&
    cur.open >= prev.close && cur.close <= prev.open &&
    Math.abs(cur.open - cur.close) > Math.abs(prev.open - prev.close) * 1.1;
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);

/**
 * supertrend-engulfing-regime — the 1+3 base (ATR SL/TP + 4H Supertrend filter)
 * plus a regime gate to lift win rate WITHOUT lowering R:R:
 *   • ADX ≥ minAdx  → only trade when the trend is strong (skips chop).
 *   • RSI guard     → don't long into overbought / short into oversold.
 * Toggle/tune via params: useAdx, minAdx, adxPeriod, useRsi, rsiPeriod,
 * longRsiMax, shortRsiMin, plus rr, slAtrMult, stPeriod, stMultiplier, atrPeriod.
 */
export class SupertrendEngulfingRegimeStrategy implements IBackTestStrategy {
  readonly name = 'supertrend-engulfing-regime';
  readonly description =
    'Supertrend-engulfing 1+3 base + ADX trend-strength gate + RSI extreme guard to raise win rate at the same R:R. M30, default 1:1.6.';
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
    const useAdx = bool(params.useAdx, true);
    const minAdx = num(params.minAdx, MIN_ADX);
    const adxPeriod = num(params.adxPeriod, ADX_PERIOD);
    const useRsi = bool(params.useRsi, true);
    const rsiPeriod = num(params.rsiPeriod, RSI_PERIOD);
    const longRsiMax = num(params.longRsiMax, LONG_RSI_MAX);
    const shortRsiMin = num(params.shortRsiMin, SHORT_RSI_MIN);

    if (candles.length < Math.max(stPeriod, atrPeriod, adxPeriod * 2, rsiPeriod) + 2) return null;
    if (current.openTime && current.openTime.getUTCHours() >= NO_ENTRY_HOUR_UTC) return null;

    const prev = candles[candles.length - 2]!;
    const trend = supertrendDirection(candles, stPeriod, stMult);

    const h4 = (htfCandles['4h'] ?? []).filter(
      (c) => c.openTime != null && current.openTime != null && c.openTime <= current.openTime
    );
    if (h4.length < stPeriod + 1) return null;
    const h4Trend = supertrendDirection(h4, stPeriod, stMult);

    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);
    const atr = calculateAtr(highs, lows, closes, atrPeriod);
    if (atr <= 0) return null;

    // ── Regime gate ────────────────────────────────────────────────────────────
    if (useAdx) {
      const adx = calculateAdx(highs, lows, closes, adxPeriod);
      if (adx < minAdx) return null;
    }
    const rsi = useRsi ? calculateRsi(closes, rsiPeriod) : 50;

    const slDist = slAtrMult * atr;
    const tpDist = rr * slDist;
    const entry = current.close;

    const longOk = trend === 'bullish' && h4Trend === 'bullish' && isBullishEngulfing(prev, current) &&
      (!useRsi || rsi <= longRsiMax);
    const shortOk = trend === 'bearish' && h4Trend === 'bearish' && isBearishEngulfing(prev, current) &&
      (!useRsi || rsi >= shortRsiMin);

    if (longOk) return { direction: 'long', entryPrice: entry, stopLoss: entry - slDist, takeProfit: entry + tpDist };
    if (shortOk) return { direction: 'short', entryPrice: entry, stopLoss: entry + slDist, takeProfit: entry - tpDist };
    return null;
  }
}

export default SupertrendEngulfingRegimeStrategy;
