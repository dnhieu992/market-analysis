import { calcUtBotSignals } from '../indicators/ut-bot';
import type { Candle } from '../types/candle';
import type { PaTrend } from './small-cap-signal';

export type LongShortScore = {
  longScore: number;
  shortScore: number;
};

export type LongShortScoreParams = {
  closes: number[];
  highs: number[];
  lows: number[];
  rsi: number;
  volMultiplier: number;
  ema34Above: boolean;
  ema89Above: boolean;
  ema200Above: boolean;
  d1Trend: PaTrend;
  h4Trend: PaTrend;
  m30Trend: PaTrend;
  sparkline: number[];
};

// ── Trend (max 2.5) ──────────────────────────────────────────────────────────

const TREND_FACTOR: Record<PaTrend, { long: number; short: number }> = {
  StrongUp:   { long: 1.0, short: 0.0 },
  Up:         { long: 0.7, short: 0.1 },
  Neutral:    { long: 0.2, short: 0.2 },
  Down:       { long: 0.1, short: 0.7 },
  StrongDown: { long: 0.0, short: 1.0 },
};

function calcTrendScore(d1: PaTrend, h4: PaTrend, m30: PaTrend) {
  const d = TREND_FACTOR[d1];
  const h = TREND_FACTOR[h4];
  const m = TREND_FACTOR[m30];
  // D1×1.2 + H4×0.8 + M30×0.5 = max 2.5
  return {
    long:  d.long  * 1.2 + h.long  * 0.8 + m.long  * 0.5,
    short: d.short * 1.2 + h.short * 0.8 + m.short * 0.5,
  };
}

// ── EMA stack (max 2.0) ──────────────────────────────────────────────────────

function calcEmaScore(ema34Above: boolean, ema89Above: boolean, ema200Above: boolean) {
  // EMA200 weighted highest (strongest trend signal), EMA34 lowest
  return {
    long:  (ema34Above ? 0.4 : 0) + (ema89Above ? 0.7 : 0) + (ema200Above ? 0.9 : 0),
    short: (!ema34Above ? 0.4 : 0) + (!ema89Above ? 0.7 : 0) + (!ema200Above ? 0.9 : 0),
  };
}

// ── UT Bot D1 (max 2.0) ──────────────────────────────────────────────────────

function calcUtBotScore(closes: number[], highs: number[], lows: number[]) {
  if (closes.length < 15) return { long: 0, short: 0 };

  const candles: Candle[] = closes.map((close, i) => ({
    open: close, high: highs[i]!, low: lows[i]!, close,
  }));

  const signals = calcUtBotSignals(candles, 1, 3);
  const last = signals[signals.length - 1]!;
  const recentBuy  = signals.slice(-3).some(s => s.buySignal);
  const recentSell = signals.slice(-3).some(s => s.sellSignal);

  if (recentBuy)       return { long: 2.0, short: 0.0 };
  if (recentSell)      return { long: 0.0, short: 2.0 };
  if (last.uptrend)    return { long: 1.0, short: 0.2 };
  return                      { long: 0.2, short: 1.0 };
}

// ── RSI (max 1.5) ────────────────────────────────────────────────────────────

function calcRsiScore(rsi: number) {
  if (rsi >= 35 && rsi <= 55) return { long: 1.5, short: 0.3 };
  if (rsi > 55 && rsi <= 65)  return { long: 0.8, short: 0.8 };
  if (rsi > 65 && rsi <= 75)  return { long: 0.3, short: 1.2 };
  if (rsi > 75)                return { long: 0.0, short: 1.5 };
  if (rsi >= 25 && rsi < 35)  return { long: 1.2, short: 0.5 };
  return                              { long: 0.6, short: 0.0 }; // rsi < 25
}

// ── Fibonacci 30d (max 1.5) ──────────────────────────────────────────────────

const FIB_LEVELS = [0.236, 0.382, 0.5, 0.618, 0.786];

function calcFiboScore(sparkline: number[]) {
  if (sparkline.length < 2) return { long: 0.5, short: 0.5 };

  const min = Math.min(...sparkline);
  const max = Math.max(...sparkline);
  const range = max - min;
  if (range === 0) return { long: 0.5, short: 0.5 };

  const price = sparkline[sparkline.length - 1]!;
  const fibRatio = (price - min) / range;

  const nearestFib = FIB_LEVELS.reduce((a, b) =>
    Math.abs(b - fibRatio) < Math.abs(a - fibRatio) ? b : a,
  );
  const dist = Math.abs(fibRatio - nearestFib);

  // Lower fib levels (≤0.5) are supports → good for Long
  // Upper fib levels (≥0.5) are resistances → good for Short
  if (dist < 0.03) {
    return { long: nearestFib <= 0.5 ? 1.5 : 0.5, short: nearestFib >= 0.5 ? 1.5 : 0.5 };
  }
  if (dist < 0.06) {
    return { long: nearestFib <= 0.5 ? 1.2 : 0.6, short: nearestFib >= 0.5 ? 1.2 : 0.6 };
  }
  if (dist < 0.10) {
    return { long: 0.8, short: 0.8 };
  }
  // Not near any level — use raw position in range
  if (fibRatio < 0.35)      return { long: 1.0, short: 0.3 };
  if (fibRatio > 0.70)      return { long: 0.3, short: 1.0 };
  return                           { long: 0.6, short: 0.6 };
}

// ── Volume (max 0.5) — confirms both directions equally ──────────────────────

function calcVolScore(vol: number) {
  const s = vol >= 2.0 ? 0.5 : vol >= 1.5 ? 0.4 : vol >= 1.0 ? 0.2 : 0.0;
  return { long: s, short: s };
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function computeLongShortScore(p: LongShortScoreParams): LongShortScore {
  const trend = calcTrendScore(p.d1Trend, p.h4Trend, p.m30Trend);
  const ema   = calcEmaScore(p.ema34Above, p.ema89Above, p.ema200Above);
  const utBot = calcUtBotScore(p.closes, p.highs, p.lows);
  const rsi   = calcRsiScore(p.rsi);
  const fibo  = calcFiboScore(p.sparkline);
  const vol   = calcVolScore(p.volMultiplier);

  const raw = (c: 'long' | 'short') =>
    trend[c] + ema[c] + utBot[c] + rsi[c] + fibo[c] + vol[c];

  const clamp = (v: number) => Math.round(Math.min(10, Math.max(0, v)) * 10) / 10;

  return { longScore: clamp(raw('long')), shortScore: clamp(raw('short')) };
}
