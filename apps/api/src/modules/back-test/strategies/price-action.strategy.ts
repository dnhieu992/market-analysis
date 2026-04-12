import { calculateAtr } from '@app/core';
import type { Candle } from '@app/core';

import type { IBackTestStrategy } from './strategy.interface';
import type { StrategyContext, TradeSignal } from '../types/back-test.types';

const ATR_PERIOD = 14;
const SR_LOOKBACK = 100;       // was 40 → 100 H1 candles (~4 days)
const SR_PROXIMITY = 0.003;    // was 0.005 → tighter 0.3%
const SR_MIN_TOUCHES = 2;      // level must be tested at least 2 times
const TREND_EMA = 21;

// ── Fix 1 — S/R extraction with swing highs/lows + min touches ──────────────

function extractSRLevels(candles: Candle[]): number[] {
  const levels: { price: number; touches: number }[] = [];

  for (let i = 2; i < candles.length - 2; i++) {
    const c = candles[i]!;

    // Swing high
    if (
      c.high > candles[i - 1]!.high && c.high > candles[i - 2]!.high &&
      c.high > candles[i + 1]!.high && c.high > candles[i + 2]!.high
    ) {
      const existing = levels.find((l) => Math.abs(l.price - c.high) / c.high < 0.002);
      if (existing) existing.touches++;
      else levels.push({ price: c.high, touches: 1 });
    }

    // Swing low
    if (
      c.low < candles[i - 1]!.low && c.low < candles[i - 2]!.low &&
      c.low < candles[i + 1]!.low && c.low < candles[i + 2]!.low
    ) {
      const existing = levels.find((l) => Math.abs(l.price - c.low) / c.low < 0.002);
      if (existing) existing.touches++;
      else levels.push({ price: c.low, touches: 1 });
    }
  }

  return levels.filter((l) => l.touches >= SR_MIN_TOUCHES).map((l) => l.price);
}

function nearLevel(price: number, level: number): boolean {
  return Math.abs(price - level) / price <= SR_PROXIMITY;
}

// ── Fix 2 — H4 trend via EMA-21 slope ───────────────────────────────────────

type TrendDirection = 'bullish' | 'bearish' | 'neutral';

function getTrendH4(candles: Candle[]): TrendDirection {
  if (candles.length < TREND_EMA + 5) return 'neutral';

  const k = 2 / (TREND_EMA + 1);
  let ema = candles.slice(0, TREND_EMA).reduce((s, c) => s + c.close, 0) / TREND_EMA;

  for (let i = TREND_EMA; i < candles.length; i++) {
    ema = candles[i]!.close * k + ema * (1 - k);
  }

  const price = candles[candles.length - 1]!.close;
  const diff = (price - ema) / ema;

  if (diff > 0.002) return 'bullish';
  if (diff < -0.002) return 'bearish';
  return 'neutral'; // neutral blocks ALL entries
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
    shadowRatio >= 0.7 && bodyRatio <= 0.25 && noseRatio <= 0.1
      ? 'high'
      : shadowRatio >= 0.65
      ? 'medium'
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
    shadowRatio >= 0.7 && bodyRatio <= 0.25 && noseRatio <= 0.1
      ? 'high'
      : shadowRatio >= 0.65
      ? 'medium'
      : 'low';

  return { valid, quality };
}

// ── Fix 4 — Confirmation candle ──────────────────────────────────────────────

function hasConfirmation(signal: 'long' | 'short', confirmCandle: Candle): boolean {
  if (signal === 'long') return confirmCandle.close > confirmCandle.open;
  return confirmCandle.close < confirmCandle.open;
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
    'Multi-timeframe price action: H4 EMA-21 trend filter, H1 swing S/R (min 2 touches), ' +
    'Pin Bar quality scoring, False Breakout with confirmation candle, London/NY session filter';
  readonly defaultTimeframe = '15m';

  evaluate(ctx: StrategyContext): TradeSignal | null {
    if (ctx.candles.length < ATR_PERIOD + 2) return null;

    const candles = ctx.candles;
    const current = ctx.current;
    // current = signal candle (prev closed), confirmCandle = the one after (latest closed)
    const prev = candles[candles.length - 2]!;

    // ── Fix 5: Session filter ──────────────────────────────────────────────
    if (prev.closeTime && !isHighLiquiditySession(new Date(prev.closeTime))) return null;

    // ── ATR ───────────────────────────────────────────────────────────────
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);
    const atr = calculateAtr(highs, lows, closes, ATR_PERIOD);

    // ── Fix 2: H4 EMA trend filter ────────────────────────────────────────
    const h4Candles = ctx.htfCandles['4h'] ?? [];
    const trend = getTrendH4(h4Candles);
    if (trend === 'neutral') return null; // no trades in sideways

    // ── Fix 1: H1 S/R via swing levels ───────────────────────────────────
    const h1Candles = ctx.htfCandles['1h'] ?? [];
    const srSource = h1Candles.length >= SR_LOOKBACK
      ? h1Candles.slice(-SR_LOOKBACK)
      : candles.slice(-SR_LOOKBACK - 1, -1);

    const srLevels = extractSRLevels(srSource);

    // Signal candle is `prev`; confirmation candle is `current`
    const signalCandle = prev;
    const confirmCandle = current;
    const entry = confirmCandle.close;

    // ── 1. Bullish Pin Bar at Support → long ──────────────────────────────
    if (trend === 'bullish') {
      const pinBar = assessBullishPinBar(signalCandle);
      if (pinBar.valid && pinBar.quality !== 'low') {
        const nearSupport = srLevels.some((lvl) => nearLevel(signalCandle.low, lvl));
        if (nearSupport && hasConfirmation('long', confirmCandle)) {
          return {
            direction: 'long',
            entryPrice: entry,
            stopLoss: signalCandle.low - atr * 0.5,
            takeProfit: entry + atr * 2
          };
        }
      }
    }

    // ── 2. Bearish Pin Bar at Resistance → short ──────────────────────────
    if (trend === 'bearish') {
      const pinBar = assessBearishPinBar(signalCandle);
      if (pinBar.valid && pinBar.quality !== 'low') {
        const nearResistance = srLevels.some((lvl) => nearLevel(signalCandle.high, lvl));
        if (nearResistance && hasConfirmation('short', confirmCandle)) {
          return {
            direction: 'short',
            entryPrice: entry,
            stopLoss: signalCandle.high + atr * 0.5,
            takeProfit: entry - atr * 2
          };
        }
      }
    }

    // ── 3. False Breakout at Support → long ──────────────────────────────
    if (trend === 'bullish') {
      const brokenSupport = srLevels.find(
        (lvl) => signalCandle.low < lvl && signalCandle.close > lvl
      );
      if (brokenSupport !== undefined && hasConfirmation('long', confirmCandle)) {
        return {
          direction: 'long',
          entryPrice: entry,
          stopLoss: signalCandle.low - atr * 0.3,
          takeProfit: entry + atr * 2
        };
      }
    }

    // ── 4. False Breakout at Resistance → short ───────────────────────────
    if (trend === 'bearish') {
      const brokenResistance = srLevels.find(
        (lvl) => signalCandle.high > lvl && signalCandle.close < lvl
      );
      if (brokenResistance !== undefined && hasConfirmation('short', confirmCandle)) {
        return {
          direction: 'short',
          entryPrice: entry,
          stopLoss: signalCandle.high + atr * 0.3,
          takeProfit: entry - atr * 2
        };
      }
    }

    return null;
  }
}

export default PriceActionStrategy;
