import { calculateAtr, extractSupportAndResistanceLevels } from '@app/core';
import type { Candle } from '@app/core';

import type { IBackTestStrategy } from './strategy.interface';
import type { StrategyContext, TradeSignal } from '../types/back-test.types';

const ATR_PERIOD = 14;
const SR_LOOKBACK = 40;
const SR_LEVELS = 5;
const SR_PROXIMITY_RATIO = 0.005; // 0.5%
const PIN_BAR_SHADOW_RATIO = 0.6;
const PIN_BAR_BODY_RATIO = 0.35;

// ── Trend detection (H4) ────────────────────────────────────────────────────

type TrendDirection = 'up' | 'down' | 'sideways';

function detectTrend(candles: Candle[]): TrendDirection {
  if (candles.length < 4) return 'sideways';

  const recent = candles.slice(-4);
  const highs = recent.map((c) => c.high);
  const lows = recent.map((c) => c.low);

  const higherHighs = highs[3]! > highs[1]! && highs[1]! > highs[0]!;
  const higherLows = lows[3]! > lows[1]! && lows[1]! > lows[0]!;
  const lowerHighs = highs[3]! < highs[1]! && highs[1]! < highs[0]!;
  const lowerLows = lows[3]! < lows[1]! && lows[1]! < lows[0]!;

  if (higherHighs && higherLows) return 'up';
  if (lowerHighs && lowerLows) return 'down';
  return 'sideways';
}

// ── Candle pattern helpers ───────────────────────────────────────────────────

type RawCandle = { open: number; close: number; high: number; low: number };

function isBullishPinBar(c: RawCandle): boolean {
  const range = c.high - c.low;
  if (range === 0) return false;
  const body = Math.abs(c.close - c.open);
  const lowerShadow = Math.min(c.open, c.close) - c.low;
  return lowerShadow / range >= PIN_BAR_SHADOW_RATIO && body / range <= PIN_BAR_BODY_RATIO;
}

function isBearishPinBar(c: RawCandle): boolean {
  const range = c.high - c.low;
  if (range === 0) return false;
  const body = Math.abs(c.close - c.open);
  const upperShadow = c.high - Math.max(c.open, c.close);
  return upperShadow / range >= PIN_BAR_SHADOW_RATIO && body / range <= PIN_BAR_BODY_RATIO;
}

function nearLevel(price: number, level: number): boolean {
  return Math.abs(price - level) / price <= SR_PROXIMITY_RATIO;
}

// ── Strategy ────────────────────────────────────────────────────────────────

export class PriceActionStrategy implements IBackTestStrategy {
  readonly name = 'price-action';
  readonly description =
    'Multi-timeframe price action: H4 trend filter, H1 S/R levels, M15/M30 entry patterns (Pin Bar, Inside Bar, False Breakout)';
  readonly defaultTimeframe = '15m';

  evaluate(ctx: StrategyContext): TradeSignal | null {
    if (ctx.candles.length < ATR_PERIOD + 2) return null;

    const candles = ctx.candles;
    const current = ctx.current;
    const prev = candles[candles.length - 2]!;
    const prevPrev = candles[candles.length - 3];

    // ── ATR from entry-TF candles ──────────────────────────────────────────
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);
    const atr = calculateAtr(highs, lows, closes, ATR_PERIOD);

    // ── H4 trend filter ───────────────────────────────────────────────────
    const h4Candles = ctx.htfCandles['4h'] ?? [];
    const trend = h4Candles.length >= 4 ? detectTrend(h4Candles) : 'sideways';

    // ── H1 S/R levels ────────────────────────────────────────────────────
    const h1Candles = ctx.htfCandles['1h'] ?? [];
    const srSource = h1Candles.length >= SR_LOOKBACK
      ? h1Candles.slice(-SR_LOOKBACK)
      : candles.slice(-SR_LOOKBACK - 1, -1); // fallback to entry-TF

    const { supportLevels, resistanceLevels } = extractSupportAndResistanceLevels(srSource, SR_LEVELS);

    const entry = current.close;

    // ── 1. Pin Bar at Support → long (only in uptrend or sideways) ─────────
    if (trend !== 'down' && isBullishPinBar(current)) {
      const nearSupport = supportLevels.some((lvl) => nearLevel(current.low, lvl));
      if (nearSupport) {
        return {
          direction: 'long',
          entryPrice: entry,
          stopLoss: current.low - atr * 0.5,
          takeProfit: entry + atr * 2
        };
      }
    }

    // ── 2. Pin Bar at Resistance → short (only in downtrend or sideways) ───
    if (trend !== 'up' && isBearishPinBar(current)) {
      const nearResistance = resistanceLevels.some((lvl) => nearLevel(current.high, lvl));
      if (nearResistance) {
        return {
          direction: 'short',
          entryPrice: entry,
          stopLoss: current.high + atr * 0.5,
          takeProfit: entry - atr * 2
        };
      }
    }

    // ── 3. False Breakout at Support → long (only in uptrend or sideways) ──
    if (trend !== 'down') {
      const brokenSupport = supportLevels.find((lvl) => current.low < lvl && current.close > lvl);
      if (brokenSupport !== undefined) {
        return {
          direction: 'long',
          entryPrice: entry,
          stopLoss: current.low - atr * 0.3,
          takeProfit: entry + atr * 2
        };
      }
    }

    // ── 4. False Breakout at Resistance → short (only in downtrend or sideways)
    if (trend !== 'up') {
      const brokenResistance = resistanceLevels.find((lvl) => current.high > lvl && current.close < lvl);
      if (brokenResistance !== undefined) {
        return {
          direction: 'short',
          entryPrice: entry,
          stopLoss: current.high + atr * 0.3,
          takeProfit: entry - atr * 2
        };
      }
    }

    // ── 5. Inside Bar Breakout (trend-aligned only) ────────────────────────
    if (prevPrev) {
      const isInsideBar = prev.high < prevPrev.high && prev.low > prevPrev.low;
      if (isInsideBar) {
        if (trend !== 'down' && current.close > prevPrev.high) {
          const risk = entry - prevPrev.low;
          return {
            direction: 'long',
            entryPrice: entry,
            stopLoss: prevPrev.low - atr * 0.3,
            takeProfit: entry + risk * 1.5
          };
        }
        if (trend !== 'up' && current.close < prevPrev.low) {
          const risk = prevPrev.high - entry;
          return {
            direction: 'short',
            entryPrice: entry,
            stopLoss: prevPrev.high + atr * 0.3,
            takeProfit: entry - risk * 1.5
          };
        }
      }
    }

    return null;
  }
}

export default PriceActionStrategy;
