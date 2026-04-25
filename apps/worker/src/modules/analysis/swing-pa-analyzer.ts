import type { Candle } from '@app/core';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SwingTrend = 'uptrend' | 'downtrend' | 'sideway';

export type SRZone = {
  low: number;
  high: number;
  midpoint: number;
  touches: number;
  role: 'support' | 'resistance';
};

export type SwingSetup = {
  type: 'break-retest' | 'pullback-hl' | 'liquidity-sweep' | null;
  direction: 'long' | 'short' | null;
  confidence: 'high' | 'medium' | 'low';
  entryZone: [number, number] | null;
  stopLoss: number | null;
  tp1: number | null;
  tp2: number | null;
  notes: string[];
};

export type ChochSignal = {
  detected: boolean;
  from: SwingTrend;
  to: SwingTrend;
  brokenLevel: number | null;
};

export type SwingPaAnalysis = {
  symbol: string;
  currentPrice: number;
  trend: SwingTrend;
  swingHighs: number[];
  swingLows: number[];
  consecutiveHhCount: number;
  consecutiveHlCount: number;
  srZones: SRZone[];
  choch: ChochSignal;
  setup: SwingSetup;
  avgVolume20: number;
};

// ── Swing detection ───────────────────────────────────────────────────────────

function findSwingHighPrices(candles: Candle[]): number[] {
  const result: number[] = [];
  for (let i = 2; i < candles.length - 2; i++) {
    const c = candles[i]!;
    if (
      c.high > candles[i - 1]!.high && c.high > candles[i - 2]!.high &&
      c.high > candles[i + 1]!.high && c.high > candles[i + 2]!.high
    ) {
      result.push(c.high);
    }
  }
  return result;
}

function findSwingLowPrices(candles: Candle[]): number[] {
  const result: number[] = [];
  for (let i = 2; i < candles.length - 2; i++) {
    const c = candles[i]!;
    if (
      c.low < candles[i - 1]!.low && c.low < candles[i - 2]!.low &&
      c.low < candles[i + 1]!.low && c.low < candles[i + 2]!.low
    ) {
      result.push(c.low);
    }
  }
  return result;
}

// ── Trend analysis ────────────────────────────────────────────────────────────

/**
 * Count consecutive ascending (or descending) pairs from the END of the array.
 * e.g. [100, 105, 103, 108, 112] → ascending from end: 108→112 = 1, 103→108 = 2, stop (105→103 not ascending)
 * Returns 2.
 */
function countConsecutivePairs(values: number[], ascending: boolean): number {
  let count = 0;
  for (let i = values.length - 1; i >= 1; i--) {
    const ok = ascending ? values[i]! > values[i - 1]! : values[i]! < values[i - 1]!;
    if (ok) count++;
    else break;
  }
  return count;
}

export function detectDailyTrend(candles: Candle[]): {
  trend: SwingTrend;
  swingHighs: number[];
  swingLows: number[];
  consecutiveHhCount: number;
  consecutiveHlCount: number;
} {
  const swingHighs = findSwingHighPrices(candles).slice(-5);
  const swingLows  = findSwingLowPrices(candles).slice(-5);

  if (swingHighs.length < 3 || swingLows.length < 3) {
    return { trend: 'sideway', swingHighs, swingLows, consecutiveHhCount: 0, consecutiveHlCount: 0 };
  }

  // "2 HH liên tiếp" = 2 pairs of consecutive HH = 3 highs all ascending → hhPairs >= 2
  const hhPairs = countConsecutivePairs(swingHighs, true);
  const hlPairs = countConsecutivePairs(swingLows,  true);
  const lhPairs = countConsecutivePairs(swingHighs, false);
  const llPairs = countConsecutivePairs(swingLows,  false);

  let trend: SwingTrend = 'sideway';
  if (hhPairs >= 2 && hlPairs >= 2) trend = 'uptrend';
  else if (lhPairs >= 2 && llPairs >= 2) trend = 'downtrend';

  return {
    trend,
    swingHighs,
    swingLows,
    consecutiveHhCount: hhPairs + 1,
    consecutiveHlCount: hlPairs + 1,
  };
}

// ── CHoCH ─────────────────────────────────────────────────────────────────────

export function detectChoch(
  candles: Candle[],
  trend: SwingTrend,
  swingHighs: number[],
  swingLows: number[]
): ChochSignal {
  const current = candles[candles.length - 1];
  if (!current) return { detected: false, from: trend, to: trend, brokenLevel: null };

  if (trend === 'uptrend' && swingLows.length >= 1) {
    const lastHl = swingLows[swingLows.length - 1]!;
    if (current.close < lastHl) {
      return { detected: true, from: 'uptrend', to: 'downtrend', brokenLevel: lastHl };
    }
  }

  if (trend === 'downtrend' && swingHighs.length >= 1) {
    const lastLh = swingHighs[swingHighs.length - 1]!;
    if (current.close > lastLh) {
      return { detected: true, from: 'downtrend', to: 'uptrend', brokenLevel: lastLh };
    }
  }

  return { detected: false, from: trend, to: trend, brokenLevel: null };
}

// ── S/R zones (Weekly candles) ────────────────────────────────────────────────

const SR_CLUSTER_TOL = 0.005; // 0.5% — cluster nearby swing points
const SR_ZONE_HALF   = 0.005; // ±0.5% zone width around midpoint

export function extractSRZones(weeklyCandles: Candle[], currentPrice: number): SRZone[] {
  const highPrices = findSwingHighPrices(weeklyCandles);
  const lowPrices  = findSwingLowPrices(weeklyCandles);

  function buildZones(prices: number[], role: 'support' | 'resistance'): SRZone[] {
    const clusters: { price: number; touches: number }[] = [];
    for (const p of prices) {
      const found = clusters.find((c) => Math.abs(c.price - p) / p < SR_CLUSTER_TOL);
      if (found) {
        found.touches++;
      } else {
        clusters.push({ price: p, touches: 1 });
      }
    }
    return clusters.map((c) => ({
      low:      c.price * (1 - SR_ZONE_HALF),
      high:     c.price * (1 + SR_ZONE_HALF),
      midpoint: c.price,
      touches:  c.touches,
      role,
    }));
  }

  const allZones = [
    ...buildZones(highPrices, 'resistance'),
    ...buildZones(lowPrices,  'support'),
  ];

  // Only zones within 30% of current price, sorted by proximity, max 5
  return allZones
    .filter((z) => Math.abs(z.midpoint - currentPrice) / currentPrice <= 0.30)
    .sort((a, b) => Math.abs(a.midpoint - currentPrice) - Math.abs(b.midpoint - currentPrice))
    .slice(0, 5);
}

// ── Volume ────────────────────────────────────────────────────────────────────

export function calcAvgVolume(candles: Candle[], period = 20): number {
  const slice = candles.slice(-period);
  if (slice.length === 0) return 0;
  return slice.reduce((s, c) => s + c.volume, 0) / slice.length;
}

// ── 4H confirmation pattern ───────────────────────────────────────────────────

function detect4HPattern(h4Candles: Candle[], trend: SwingTrend): string | null {
  if (h4Candles.length < 2) return null;
  const curr = h4Candles[h4Candles.length - 1]!;
  const prev = h4Candles[h4Candles.length - 2]!;
  const range = curr.high - curr.low;
  if (range === 0) return null;
  const body  = Math.abs(curr.close - curr.open);
  const lower = Math.min(curr.open, curr.close) - curr.low;
  const upper = curr.high - Math.max(curr.open, curr.close);

  if (trend === 'uptrend'   && lower / range >= 0.6 && body / range <= 0.35) return 'Bullish Pin Bar';
  if (trend === 'downtrend' && upper / range >= 0.6 && body / range <= 0.35) return 'Bearish Pin Bar';
  if (trend === 'uptrend'   && curr.close > curr.open && prev.close < prev.open
      && curr.open <= prev.close && curr.close >= prev.open) return 'Bullish Engulfing';
  if (trend === 'downtrend' && curr.close < curr.open && prev.close > prev.open
      && curr.open >= prev.close && curr.close <= prev.open) return 'Bearish Engulfing';

  return null;
}

// ── Helper ────────────────────────────────────────────────────────────────────

function fmtPrice(n: number): string {
  return n >= 1000
    ? n.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : n.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

// ── Setup 1: Break & Retest ───────────────────────────────────────────────────

const RETEST_WINDOW = 5;

function detectBreakRetest(
  dailyCandles: Candle[],
  h4Candles: Candle[],
  srZones: SRZone[],
  trend: SwingTrend,
  avgVol: number
): SwingSetup | null {
  if (trend === 'sideway' || dailyCandles.length < RETEST_WINDOW + 2) return null;

  const current  = dailyCandles[dailyCandles.length - 1]!;
  // examine last 5 closed candles (excluding current)
  const lookback = dailyCandles.slice(-(RETEST_WINDOW + 1), -1);

  for (const zone of srZones) {
    for (let i = 0; i < lookback.length; i++) {
      const c = lookback[i]!;
      const candlesAgo = lookback.length - i;

      const brokeBullish = trend === 'uptrend'
        && zone.role === 'resistance'
        && c.close > zone.high   // closed above resistance
        && c.open  < zone.high;  // opened below/inside

      const brokeBearish = trend === 'downtrend'
        && zone.role === 'support'
        && c.close < zone.low    // closed below support
        && c.open  > zone.low;

      if (!brokeBullish && !brokeBearish) continue;

      // Current candle must overlap the zone (retest)
      const retesting = current.low <= zone.high && current.high >= zone.low;
      if (!retesting) continue;

      const highVolBreak = c.volume > avgVol;
      const h4Pattern    = detect4HPattern(h4Candles, trend);
      const direction: 'long' | 'short' = brokeBullish ? 'long' : 'short';

      const confidence: 'high' | 'medium' | 'low' =
        highVolBreak && h4Pattern !== null ? 'high' :
        highVolBreak || h4Pattern !== null ? 'medium' : 'low';

      return {
        type: 'break-retest',
        direction,
        confidence,
        entryZone: [zone.low, zone.high],
        stopLoss:  direction === 'long' ? zone.low * 0.995 : zone.high * 1.005,
        tp1:       direction === 'long' ? zone.midpoint * 1.03 : zone.midpoint * 0.97,
        tp2:       null,
        notes: [
          `Broke ${zone.role} zone ${fmtPrice(zone.midpoint)} (${candlesAgo} candle(s) ago)`,
          highVolBreak ? 'High volume on breakout ✅' : 'Low volume breakout ⚠️',
          h4Pattern ? `4H pattern: ${h4Pattern} ✅` : 'No 4H confirmation yet ⏳',
        ],
      };
    }
  }

  return null;
}

// ── Setup 2: Pullback to HL / LH ─────────────────────────────────────────────

function detectPullbackHl(
  dailyCandles: Candle[],
  trend: SwingTrend,
  swingHighs: number[],
  swingLows: number[],
  srZones: SRZone[],
  consecutiveHhCount: number,
  consecutiveHlCount: number
): SwingSetup | null {
  if (trend === 'sideway') return null;
  // Require strong trend: at least 3 consecutive HH (or HL)
  if (consecutiveHhCount < 3 && consecutiveHlCount < 3) return null;

  const current = dailyCandles[dailyCandles.length - 1]!;
  const last3   = dailyCandles.slice(-3);
  const volDeclining = last3.length === 3
    && last3[2]!.volume < last3[1]!.volume
    && last3[1]!.volume < last3[0]!.volume;

  if (trend === 'uptrend' && swingLows.length >= 1) {
    const lastHl = swingLows[swingLows.length - 1]!;
    if (Math.abs(current.close - lastHl) / lastHl > 0.03) return null;

    const confluence = srZones.find((z) => Math.abs(z.midpoint - lastHl) / lastHl < 0.02);

    return {
      type: 'pullback-hl',
      direction: 'long',
      confidence: volDeclining && confluence ? 'high' : volDeclining || confluence ? 'medium' : 'low',
      entryZone: [lastHl * 0.99, lastHl * 1.01],
      stopLoss:  lastHl * 0.985,
      tp1:       swingHighs[swingHighs.length - 1] ?? current.close * 1.05,
      tp2:       null,
      notes: [
        `Pullback to last HL: ${fmtPrice(lastHl)}`,
        volDeclining ? 'Volume declining in pullback ✅' : 'Volume not declining ⚠️',
        confluence ? `S/R confluence at ${fmtPrice(confluence.midpoint)} ✅` : 'No S/R confluence ⚠️',
      ],
    };
  }

  if (trend === 'downtrend' && swingHighs.length >= 1) {
    const lastLh = swingHighs[swingHighs.length - 1]!;
    if (Math.abs(current.close - lastLh) / lastLh > 0.03) return null;

    const confluence = srZones.find((z) => Math.abs(z.midpoint - lastLh) / lastLh < 0.02);

    return {
      type: 'pullback-hl',
      direction: 'short',
      confidence: volDeclining && confluence ? 'high' : volDeclining || confluence ? 'medium' : 'low',
      entryZone: [lastLh * 0.99, lastLh * 1.01],
      stopLoss:  lastLh * 1.015,
      tp1:       swingLows[swingLows.length - 1] ?? current.close * 0.95,
      tp2:       null,
      notes: [
        `Pullback to last LH: ${fmtPrice(lastLh)}`,
        volDeclining ? 'Volume declining in pullback ✅' : 'Volume not declining ⚠️',
        confluence ? `S/R confluence at ${fmtPrice(confluence.midpoint)} ✅` : 'No S/R confluence ⚠️',
      ],
    };
  }

  return null;
}

// ── Setup 3: Liquidity Sweep + Reversal ───────────────────────────────────────

function detectLiquiditySweep(
  dailyCandles: Candle[],
  trend: SwingTrend,
  swingHighs: number[],
  swingLows: number[],
  avgVol: number
): SwingSetup | null {
  if (dailyCandles.length < 2) return null;
  const current   = dailyCandles[dailyCandles.length - 1]!;
  const body      = Math.abs(current.close - current.open);
  const lowerWick = Math.min(current.open, current.close) - current.low;
  const upperWick = current.high - Math.max(current.open, current.close);
  const volSpike  = current.volume > avgVol * 1.5;

  // Bullish sweep: wick pierced a swing low but close recovered above it
  if (swingLows.length >= 1 && trend !== 'downtrend') {
    const nearestLow = swingLows[swingLows.length - 1]!;
    if (
      current.low < nearestLow &&
      current.close > nearestLow &&
      body > 0 &&
      lowerWick >= 1.5 * body
    ) {
      return {
        type: 'liquidity-sweep',
        direction: 'long',
        confidence: volSpike ? 'high' : 'medium',
        entryZone: [current.close * 0.998, current.close * 1.002],
        stopLoss:  current.low * 0.997,
        tp1:       swingHighs[swingHighs.length - 1] ?? current.close * 1.04,
        tp2:       null,
        notes: [
          `Swept swing low at ${fmtPrice(nearestLow)}`,
          'Long lower wick rejection ✅',
          volSpike ? 'Volume spike confirmed ✅' : 'Volume spike not confirmed ⚠️',
          'Trend structure intact — sweep only',
        ],
      };
    }
  }

  // Bearish sweep: wick pierced a swing high but close dropped back below
  if (swingHighs.length >= 1 && trend !== 'uptrend') {
    const nearestHigh = swingHighs[swingHighs.length - 1]!;
    if (
      current.high > nearestHigh &&
      current.close < nearestHigh &&
      body > 0 &&
      upperWick >= 1.5 * body
    ) {
      return {
        type: 'liquidity-sweep',
        direction: 'short',
        confidence: volSpike ? 'high' : 'medium',
        entryZone: [current.close * 0.998, current.close * 1.002],
        stopLoss:  current.high * 1.003,
        tp1:       swingLows[swingLows.length - 1] ?? current.close * 0.96,
        tp2:       null,
        notes: [
          `Swept swing high at ${fmtPrice(nearestHigh)}`,
          'Long upper wick rejection ✅',
          volSpike ? 'Volume spike confirmed ✅' : 'Volume spike not confirmed ⚠️',
          'Trend structure intact — sweep only',
        ],
      };
    }
  }

  return null;
}

// ── Main entry point ──────────────────────────────────────────────────────────

export function analyzeSwingPa(
  symbol: string,
  dailyCandles: Candle[],
  weeklyCandles: Candle[],
  h4Candles: Candle[]
): SwingPaAnalysis {
  if (dailyCandles.length < 10) {
    throw new Error('Insufficient daily candles for swing PA analysis');
  }

  const currentPrice = dailyCandles[dailyCandles.length - 1]!.close;
  const avgVol       = calcAvgVolume(dailyCandles, 20);

  const { trend, swingHighs, swingLows, consecutiveHhCount, consecutiveHlCount } =
    detectDailyTrend(dailyCandles);

  const choch   = detectChoch(dailyCandles, trend, swingHighs, swingLows);
  const srZones = extractSRZones(weeklyCandles, currentPrice);

  // Priority: liquidity sweep → break & retest → pullback to HL
  const setup: SwingSetup =
    detectLiquiditySweep(dailyCandles, trend, swingHighs, swingLows, avgVol) ??
    detectBreakRetest(dailyCandles, h4Candles, srZones, trend, avgVol) ??
    detectPullbackHl(dailyCandles, trend, swingHighs, swingLows, srZones, consecutiveHhCount, consecutiveHlCount) ??
    { type: null, direction: null, confidence: 'low', entryZone: null, stopLoss: null, tp1: null, tp2: null, notes: ['No active setup detected on current candle'] };

  // Fill TP2 from the next S/R zone beyond TP1
  if (setup.tp1 !== null && setup.tp2 === null && setup.direction !== null) {
    const isLong   = setup.direction === 'long';
    const nextZone = isLong
      ? srZones.find((z) => z.midpoint > setup.tp1! && z.role === 'resistance')
      : srZones.find((z) => z.midpoint < setup.tp1! && z.role === 'support');
    if (nextZone) setup.tp2 = nextZone.midpoint;
  }

  return {
    symbol,
    currentPrice,
    trend,
    swingHighs,
    swingLows,
    consecutiveHhCount,
    consecutiveHlCount,
    srZones,
    choch,
    setup,
    avgVolume20: avgVol,
  };
}
