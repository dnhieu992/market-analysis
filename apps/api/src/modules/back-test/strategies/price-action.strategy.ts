import { calculateAtr } from '@app/core';
import type { Candle } from '@app/core';

import type { IBackTestStrategy } from './strategy.interface';
import type { StrategyContext, TradeSignal } from '../types/back-test.types';

const ATR_PERIOD = 14;
const SR_LOOKBACK = 100;       // 100 H1 candles (~4 days)
const SR_CLUSTER_TOL = 0.003;  // 0.3% — cluster swing points into one level
const SR_PROXIMITY = 0.005;    // 0.5% — how close price must be to qualify
const SR_MIN_TOUCHES = 1;      // swing touches needed to qualify a level
const TREND_EMA = 21;
const TREND_EMA_MIN_DIFF = 0.001; // 0.1% from EMA to confirm trend direction

// ── Fix 1 — S/R via swing highs/lows + cluster deduplication ────────────────

function extractSRLevels(candles: Candle[]): { supports: number[]; resistances: number[] } {
  const swingHighs: { price: number; touches: number }[] = [];
  const swingLows: { price: number; touches: number }[] = [];

  for (let i = 2; i < candles.length - 2; i++) {
    const c = candles[i]!;

    // Swing high (local max over 5 candles)
    if (
      c.high > candles[i - 1]!.high && c.high > candles[i - 2]!.high &&
      c.high > candles[i + 1]!.high && c.high > candles[i + 2]!.high
    ) {
      const existing = swingHighs.find((l) => Math.abs(l.price - c.high) / c.high < SR_CLUSTER_TOL);
      if (existing) existing.touches++;
      else swingHighs.push({ price: c.high, touches: 1 });
    }

    // Swing low (local min over 5 candles)
    if (
      c.low < candles[i - 1]!.low && c.low < candles[i - 2]!.low &&
      c.low < candles[i + 1]!.low && c.low < candles[i + 2]!.low
    ) {
      const existing = swingLows.find((l) => Math.abs(l.price - c.low) / c.low < SR_CLUSTER_TOL);
      if (existing) existing.touches++;
      else swingLows.push({ price: c.low, touches: 1 });
    }
  }

  return {
    supports: swingLows.filter((l) => l.touches >= SR_MIN_TOUCHES).map((l) => l.price),
    resistances: swingHighs.filter((l) => l.touches >= SR_MIN_TOUCHES).map((l) => l.price),
  };
}

function nearLevel(price: number, level: number): boolean {
  return Math.abs(price - level) / price <= SR_PROXIMITY;
}

// ── Fix 2 — H4 trend via EMA-21; falls back to HH/HL if data is thin ────────

type TrendDirection = 'bullish' | 'bearish' | 'neutral';

function getTrendH4(candles: Candle[]): TrendDirection {
  // Not enough candles for EMA — fall back to simple HH/HL over last 6 candles
  if (candles.length < TREND_EMA + 5) {
    if (candles.length < 6) return 'neutral';
    const recent = candles.slice(-6);
    const highs = recent.map((c) => c.high);
    const lows = recent.map((c) => c.low);
    const higherHighs = highs[5]! > highs[3]! && highs[3]! > highs[0]!;
    const higherLows = lows[5]! > lows[3]! && lows[3]! > lows[0]!;
    const lowerHighs = highs[5]! < highs[3]! && highs[3]! < highs[0]!;
    const lowerLows = lows[5]! < lows[3]! && lows[3]! < lows[0]!;
    if (higherHighs && higherLows) return 'bullish';
    if (lowerHighs && lowerLows) return 'bearish';
    return 'neutral';
  }

  // EMA-21 slope
  const k = 2 / (TREND_EMA + 1);
  let ema = candles.slice(0, TREND_EMA).reduce((s, c) => s + c.close, 0) / TREND_EMA;
  for (let i = TREND_EMA; i < candles.length; i++) {
    ema = candles[i]!.close * k + ema * (1 - k);
  }

  const price = candles[candles.length - 1]!.close;
  const diff = (price - ema) / ema;

  if (diff > TREND_EMA_MIN_DIFF) return 'bullish';
  if (diff < -TREND_EMA_MIN_DIFF) return 'bearish';
  return 'neutral';
}

// ── Fix 3 — Pin bar quality scoring ─────────────────────────────────────────

type PinBarQuality = 'high' | 'medium' | 'low';

interface PinBarResult {
  valid: boolean;
  quality: PinBarQuality;
}

function assessBullishPinBar(c: Candle): PinBarResult {
  const range = c.high - c.low;
  if (range === 0) return { valid: false, quality: 'low' };

  const lowerShadow = Math.min(c.open, c.close) - c.low;
  const upperShadow = c.high - Math.max(c.open, c.close);
  const body = Math.abs(c.close - c.open);

  const shadowRatio = lowerShadow / range;
  const bodyRatio = body / range;
  const noseRatio = upperShadow / range;

  const valid = shadowRatio >= 0.6 && bodyRatio <= 0.35;
  if (!valid) return { valid: false, quality: 'low' };

  const quality: PinBarQuality =
    shadowRatio >= 0.7 && bodyRatio <= 0.25 && noseRatio <= 0.1 ? 'high'
    : shadowRatio >= 0.65 ? 'medium'
    : 'low';

  return { valid, quality };
}

function assessBearishPinBar(c: Candle): PinBarResult {
  const range = c.high - c.low;
  if (range === 0) return { valid: false, quality: 'low' };

  const upperShadow = c.high - Math.max(c.open, c.close);
  const lowerShadow = Math.min(c.open, c.close) - c.low;
  const body = Math.abs(c.close - c.open);

  const shadowRatio = upperShadow / range;
  const bodyRatio = body / range;
  const noseRatio = lowerShadow / range;

  const valid = shadowRatio >= 0.6 && bodyRatio <= 0.35;
  if (!valid) return { valid: false, quality: 'low' };

  const quality: PinBarQuality =
    shadowRatio >= 0.7 && bodyRatio <= 0.25 && noseRatio <= 0.1 ? 'high'
    : shadowRatio >= 0.65 ? 'medium'
    : 'low';

  return { valid, quality };
}

// ── Fix 5 — Session filter (London open + NY session) ────────────────────────

function isHighLiquiditySession(time: Date): boolean {
  const hour = time.getUTCHours();
  return (hour >= 7 && hour < 12) || (hour >= 13 && hour < 21);
}

// ── Strategy ────────────────────────────────────────────────────────────────

export class PriceActionStrategy implements IBackTestStrategy {
  readonly name = 'price-action';
  readonly description =
    'Multi-timeframe price action: H4 EMA-21 trend filter, H1 swing S/R, ' +
    'Pin Bar quality scoring (high/medium only), False Breakout, London/NY session filter';
  readonly defaultTimeframe = '15m';

  evaluate(ctx: StrategyContext): TradeSignal | null {
    if (ctx.candles.length < ATR_PERIOD + 2) return null;

    const candles = ctx.candles;
    const current = ctx.current; // signal candle (latest closed)

    // ── Fix 5: Session filter (skip if closeTime not available) ───────────
    const candleTime = current.closeTime ?? current.openTime;
    if (candleTime && !isHighLiquiditySession(new Date(candleTime))) return null;

    // ── ATR ───────────────────────────────────────────────────────────────
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);
    const atr = calculateAtr(highs, lows, closes, ATR_PERIOD);

    // ── Fix 2: H4 trend filter (with HH/HL fallback) ─────────────────────
    const h4Candles = ctx.htfCandles['4h'] ?? [];
    const trend = getTrendH4(h4Candles);
    if (trend === 'neutral') return null;

    // ── Fix 1: H1 S/R via swing levels ───────────────────────────────────
    const h1Candles = ctx.htfCandles['1h'] ?? [];
    const srSource = h1Candles.length >= SR_LOOKBACK
      ? h1Candles.slice(-SR_LOOKBACK)
      : candles.slice(-SR_LOOKBACK - 1, -1);

    const { supports, resistances } = extractSRLevels(srSource);

    const entry = current.close;

    // ── 1. Bullish Pin Bar at Support → long ──────────────────────────────
    if (trend === 'bullish') {
      const pinBar = assessBullishPinBar(current);
      if (pinBar.valid && pinBar.quality !== 'low') {
        const nearSupport = supports.some((lvl) => nearLevel(current.low, lvl));
        if (nearSupport) {
          return {
            direction: 'long',
            entryPrice: entry,
            stopLoss: current.low - atr * 0.5,
            takeProfit: entry + atr * 2
          };
        }
      }
    }

    // ── 2. Bearish Pin Bar at Resistance → short ──────────────────────────
    if (trend === 'bearish') {
      const pinBar = assessBearishPinBar(current);
      if (pinBar.valid && pinBar.quality !== 'low') {
        const nearResistance = resistances.some((lvl) => nearLevel(current.high, lvl));
        if (nearResistance) {
          return {
            direction: 'short',
            entryPrice: entry,
            stopLoss: current.high + atr * 0.5,
            takeProfit: entry - atr * 2
          };
        }
      }
    }

    // ── 3. False Breakout at Support → long ──────────────────────────────
    if (trend === 'bullish') {
      const brokenSupport = supports.find((lvl) => current.low < lvl && current.close > lvl);
      if (brokenSupport !== undefined) {
        return {
          direction: 'long',
          entryPrice: entry,
          stopLoss: current.low - atr * 0.3,
          takeProfit: entry + atr * 2
        };
      }
    }

    // ── 4. False Breakout at Resistance → short ───────────────────────────
    if (trend === 'bearish') {
      const brokenResistance = resistances.find((lvl) => current.high > lvl && current.close < lvl);
      if (brokenResistance !== undefined) {
        return {
          direction: 'short',
          entryPrice: entry,
          stopLoss: current.high + atr * 0.3,
          takeProfit: entry - atr * 2
        };
      }
    }

    return null;
  }
}

export default PriceActionStrategy;
