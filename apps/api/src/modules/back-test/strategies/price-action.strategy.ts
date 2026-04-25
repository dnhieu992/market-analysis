import type { Candle } from '@app/core';

import type { IBackTestStrategy } from './strategy.interface';
import type { StrategyContext, TradeSignal } from '../types/back-test.types';

// ── Pure Price Action — Swing Trading (Daily)  ────────────────────────────────
//
// Rules:
//  - NO indicators (no EMA, RSI, ATR, Bollinger, etc.)
//  - Trend from HH/HL or LH/LL structure only (need 2+ consecutive pairs)
//  - S/R zones drawn from the longer daily history (proxies weekly levels)
//  - Zone width ±0.5%, cluster tolerance 0.5%
//  - Volume confirmation on breakout candles
//  - 3 setups: Liquidity Sweep → Break & Retest → Pullback to HL/LH
//  - SL: zone boundary + 0.5% buffer; TP: next S/R zone (fallback: 2× risk)

const SR_LOOKBACK    = 120;   // daily candles used for S/R extraction
const SR_CLUSTER_TOL = 0.005; // 0.5% — merge nearby swing points into one zone
const SR_ZONE_HALF   = 0.005; // ±0.5% zone width around midpoint
const SR_MAX_DIST    = 0.30;  // ignore zones more than 30% from current price
const RETEST_WINDOW  = 5;     // max candles after breakout to still qualify as retest
const PULLBACK_DIST  = 0.03;  // price must be within 3% of HL/LH to count as pullback
const MIN_HH_PAIRS   = 2;     // need 2+ consecutive HH pairs (3 swing highs) for trend
const SWEEP_WICK_MULT = 1.5;  // wick must be ≥ 1.5× body to qualify as sweep
const VOL_SPIKE_MULT  = 1.5;  // volume spike = 1.5× 20-period average

// ── Swing detection ───────────────────────────────────────────────────────────

function swingHighPrices(candles: Candle[]): number[] {
  const result: number[] = [];
  for (let i = 2; i < candles.length - 2; i++) {
    const c = candles[i]!;
    if (
      c.high > candles[i - 1]!.high && c.high > candles[i - 2]!.high &&
      c.high > candles[i + 1]!.high && c.high > candles[i + 2]!.high
    ) result.push(c.high);
  }
  return result;
}

function swingLowPrices(candles: Candle[]): number[] {
  const result: number[] = [];
  for (let i = 2; i < candles.length - 2; i++) {
    const c = candles[i]!;
    if (
      c.low < candles[i - 1]!.low && c.low < candles[i - 2]!.low &&
      c.low < candles[i + 1]!.low && c.low < candles[i + 2]!.low
    ) result.push(c.low);
  }
  return result;
}

// ── Trend: HH/HL structure ────────────────────────────────────────────────────

type Trend = 'uptrend' | 'downtrend' | 'sideway';

/** Count consecutive ascending or descending pairs from the end of the array. */
function consecutivePairs(values: number[], ascending: boolean): number {
  let n = 0;
  for (let i = values.length - 1; i >= 1; i--) {
    if (ascending ? values[i]! > values[i - 1]! : values[i]! < values[i - 1]!) n++;
    else break;
  }
  return n;
}

function detectTrend(candles: Candle[]): {
  trend: Trend;
  swingHighs: number[];
  swingLows: number[];
  hhCount: number;
  hlCount: number;
} {
  const highs = swingHighPrices(candles).slice(-5);
  const lows  = swingLowPrices(candles).slice(-5);

  if (highs.length < 3 || lows.length < 3) {
    return { trend: 'sideway', swingHighs: highs, swingLows: lows, hhCount: 0, hlCount: 0 };
  }

  const hhPairs = consecutivePairs(highs, true);
  const hlPairs = consecutivePairs(lows,  true);
  const lhPairs = consecutivePairs(highs, false);
  const llPairs = consecutivePairs(lows,  false);

  let trend: Trend = 'sideway';
  if (hhPairs >= MIN_HH_PAIRS && hlPairs >= MIN_HH_PAIRS) trend = 'uptrend';
  else if (lhPairs >= MIN_HH_PAIRS && llPairs >= MIN_HH_PAIRS) trend = 'downtrend';

  return { trend, swingHighs: highs, swingLows: lows, hhCount: hhPairs + 1, hlCount: hlPairs + 1 };
}

// ── S/R zones ────────────────────────────────────────────────────────────────

type SRZone = { low: number; high: number; mid: number; touches: number; role: 'support' | 'resistance' };

function extractSRZones(candles: Candle[], currentPrice: number): SRZone[] {
  const source = candles.slice(-SR_LOOKBACK);
  const highPrices = swingHighPrices(source);
  const lowPrices  = swingLowPrices(source);

  function cluster(prices: number[], role: 'support' | 'resistance'): SRZone[] {
    const groups: { price: number; touches: number }[] = [];
    for (const p of prices) {
      const found = groups.find((g) => Math.abs(g.price - p) / p < SR_CLUSTER_TOL);
      if (found) found.touches++;
      else groups.push({ price: p, touches: 1 });
    }
    return groups.map((g) => ({
      low:     g.price * (1 - SR_ZONE_HALF),
      high:    g.price * (1 + SR_ZONE_HALF),
      mid:     g.price,
      touches: g.touches,
      role,
    }));
  }

  return [
    ...cluster(highPrices, 'resistance'),
    ...cluster(lowPrices,  'support'),
  ]
    .filter((z) => Math.abs(z.mid - currentPrice) / currentPrice <= SR_MAX_DIST)
    .sort((a, b) => Math.abs(a.mid - currentPrice) - Math.abs(b.mid - currentPrice))
    .slice(0, 5);
}

// ── Volume helpers ────────────────────────────────────────────────────────────

function avgVol(candles: Candle[], period = 20): number {
  const slice = candles.slice(-period);
  return slice.length ? slice.reduce((s, c) => s + c.volume, 0) / slice.length : 0;
}

// ── 4H confirmation pattern ───────────────────────────────────────────────────

function has4HConfirmation(h4Candles: Candle[], trend: Trend): boolean {
  if (h4Candles.length < 2) return false;
  const curr = h4Candles[h4Candles.length - 1]!;
  const prev = h4Candles[h4Candles.length - 2]!;
  const range = curr.high - curr.low;
  if (range === 0) return false;
  const body  = Math.abs(curr.close - curr.open);
  const lower = Math.min(curr.open, curr.close) - curr.low;
  const upper = curr.high - Math.max(curr.open, curr.close);

  // Bullish pin bar or engulfing
  if (trend === 'uptrend') {
    if (lower / range >= 0.6 && body / range <= 0.35) return true;
    if (curr.close > curr.open && prev.close < prev.open
        && curr.open <= prev.close && curr.close >= prev.open) return true;
  }
  // Bearish pin bar or engulfing
  if (trend === 'downtrend') {
    if (upper / range >= 0.6 && body / range <= 0.35) return true;
    if (curr.close < curr.open && prev.close > prev.open
        && curr.open >= prev.close && curr.close <= prev.open) return true;
  }
  return false;
}

// ── TP: next S/R zone or 2× risk fallback ─────────────────────────────────────

function resolveTP(
  direction: 'long' | 'short',
  entry: number,
  sl: number,
  zones: SRZone[]
): number {
  const risk = Math.abs(entry - sl);
  if (direction === 'long') {
    const next = zones.find((z) => z.role === 'resistance' && z.mid > entry);
    return next ? next.mid : entry + risk * 2;
  }
  const next = zones.find((z) => z.role === 'support' && z.mid < entry);
  return next ? next.mid : entry - risk * 2;
}

// ── Setup 1: Liquidity Sweep + Reversal ───────────────────────────────────────

function checkLiquiditySweep(
  current: Candle,
  trend: Trend,
  swingHighs: number[],
  swingLows: number[],
  av: number,
  zones: SRZone[]
): TradeSignal | null {
  const body      = Math.abs(current.close - current.open);
  const lowerWick = Math.min(current.open, current.close) - current.low;
  const upperWick = current.high - Math.max(current.open, current.close);
  const volSpike  = current.volume > av * VOL_SPIKE_MULT;

  // Bullish: wick swept below a swing low, closed back above it
  if (swingLows.length >= 1 && trend !== 'downtrend') {
    const nearestLow = swingLows[swingLows.length - 1]!;
    if (
      current.low < nearestLow &&
      current.close > nearestLow &&
      body > 0 &&
      lowerWick >= SWEEP_WICK_MULT * body &&
      volSpike
    ) {
      const entry = current.close;
      const sl    = current.low * 0.997;
      return { direction: 'long', entryPrice: entry, stopLoss: sl, takeProfit: resolveTP('long', entry, sl, zones) };
    }
  }

  // Bearish: wick swept above a swing high, closed back below it
  if (swingHighs.length >= 1 && trend !== 'uptrend') {
    const nearestHigh = swingHighs[swingHighs.length - 1]!;
    if (
      current.high > nearestHigh &&
      current.close < nearestHigh &&
      body > 0 &&
      upperWick >= SWEEP_WICK_MULT * body &&
      volSpike
    ) {
      const entry = current.close;
      const sl    = current.high * 1.003;
      return { direction: 'short', entryPrice: entry, stopLoss: sl, takeProfit: resolveTP('short', entry, sl, zones) };
    }
  }

  return null;
}

// ── Setup 2: Break & Retest ───────────────────────────────────────────────────

function checkBreakRetest(
  candles: Candle[],
  current: Candle,
  trend: Trend,
  av: number,
  zones: SRZone[],
  h4Candles: Candle[]
): TradeSignal | null {
  if (trend === 'sideway' || candles.length < RETEST_WINDOW + 2) return null;

  // Closed candles before current (last RETEST_WINDOW)
  const lookback = candles.slice(-(RETEST_WINDOW + 1), -1);

  for (const zone of zones) {
    for (let i = 0; i < lookback.length; i++) {
      const c = lookback[i]!;

      const brokeLong  = trend === 'uptrend'   && zone.role === 'resistance'
        && c.close > zone.high && c.open < zone.high;
      const brokeShort = trend === 'downtrend' && zone.role === 'support'
        && c.close < zone.low  && c.open > zone.low;

      if (!brokeLong && !brokeShort) continue;

      // Breakout candle must have above-average volume
      if (c.volume <= av) continue;

      // Current candle must be retesting the zone
      const retesting = current.low <= zone.high && current.high >= zone.low;
      if (!retesting) continue;

      // At least medium confidence: high-volume break is already confirmed;
      // 4H pattern is bonus but not required
      const confirmed = has4HConfirmation(h4Candles, trend);
      if (!confirmed && c.volume < av * 1.2) continue; // skip low-quality breaks without 4H confirm

      if (brokeLong) {
        const entry = current.close;
        const sl    = zone.low * 0.995;
        return { direction: 'long', entryPrice: entry, stopLoss: sl, takeProfit: resolveTP('long', entry, sl, zones) };
      }

      const entry = current.close;
      const sl    = zone.high * 1.005;
      return { direction: 'short', entryPrice: entry, stopLoss: sl, takeProfit: resolveTP('short', entry, sl, zones) };
    }
  }

  return null;
}

// ── Setup 3: Pullback to Higher Low / Lower High ──────────────────────────────

function checkPullbackHl(
  candles: Candle[],
  current: Candle,
  trend: Trend,
  swingHighs: number[],
  swingLows: number[],
  hhCount: number,
  hlCount: number,
  zones: SRZone[]
): TradeSignal | null {
  if (trend === 'sideway') return null;
  // Strong trend required (3+ consecutive HH/HL)
  if (hhCount < 3 && hlCount < 3) return null;

  const last3 = candles.slice(-3);
  const volDeclining = last3.length === 3
    && last3[2]!.volume < last3[1]!.volume
    && last3[1]!.volume < last3[0]!.volume;

  if (trend === 'uptrend' && swingLows.length >= 1) {
    const lastHl = swingLows[swingLows.length - 1]!;
    if (Math.abs(current.close - lastHl) / lastHl > PULLBACK_DIST) return null;
    if (!volDeclining) return null;

    // Optional: S/R confluence
    const hasConfluence = zones.some((z) => Math.abs(z.mid - lastHl) / lastHl < 0.02);
    if (!hasConfluence) return null;

    const entry = current.close;
    const sl    = lastHl * 0.985;
    return { direction: 'long', entryPrice: entry, stopLoss: sl, takeProfit: resolveTP('long', entry, sl, zones) };
  }

  if (trend === 'downtrend' && swingHighs.length >= 1) {
    const lastLh = swingHighs[swingHighs.length - 1]!;
    if (Math.abs(current.close - lastLh) / lastLh > PULLBACK_DIST) return null;
    if (!volDeclining) return null;

    const hasConfluence = zones.some((z) => Math.abs(z.mid - lastLh) / lastLh < 0.02);
    if (!hasConfluence) return null;

    const entry = current.close;
    const sl    = lastLh * 1.015;
    return { direction: 'short', entryPrice: entry, stopLoss: sl, takeProfit: resolveTP('short', entry, sl, zones) };
  }

  return null;
}

// ── Strategy ──────────────────────────────────────────────────────────────────

export class PriceActionStrategy implements IBackTestStrategy {
  readonly name = 'price-action';
  readonly description =
    'Pure Price Action — Swing (Daily): HH/HL trend structure (no indicators), ' +
    'S/R zones from daily history, volume confirmation. ' +
    'Setups: Liquidity Sweep → Break & Retest → Pullback to HL/LH.';
  readonly defaultTimeframe = '1d';
  readonly forcedTimeframe  = '1d';

  evaluate(ctx: StrategyContext): TradeSignal | null {
    if (ctx.candles.length < 20) return null;

    const candles = ctx.candles;
    const current = ctx.current;

    // ── 1. Trend (Daily HH/HL — no EMA) ─────────────────────────────────
    const { trend, swingHighs, swingLows, hhCount, hlCount } = detectTrend(candles);
    if (trend === 'sideway') return null;

    // ── 2. S/R zones (from daily lookback, proxying weekly levels) ────────
    const zones = extractSRZones(candles, current.close);

    // ── 3. Volume baseline ────────────────────────────────────────────────
    const av = avgVol(candles, 20);

    // ── 4H confirmation candles ───────────────────────────────────────────
    const h4Candles = ctx.htfCandles['4h'] ?? [];

    // ── Setup priority: Sweep → Break & Retest → Pullback ─────────────────
    return (
      checkLiquiditySweep(current, trend, swingHighs, swingLows, av, zones) ??
      checkBreakRetest(candles, current, trend, av, zones, h4Candles) ??
      checkPullbackHl(candles, current, trend, swingHighs, swingLows, hhCount, hlCount, zones) ??
      null
    );
  }
}

export default PriceActionStrategy;
