import type { Candle } from '../types/candle';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SwingType = 'high' | 'low';

export type SwingPoint = {
  type: SwingType;
  price: number;
  time: Date;
  index: number;
};

export type TrendDirection = 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS';
export type TrendStrength = 'STRONG' | 'MODERATE' | 'WEAK';

export type TrendResult = {
  direction: TrendDirection;
  strength: TrendStrength;
  consecutiveHH: number;
  consecutiveHL: number;
};

export type VolumeTrend = 'INCREASING' | 'DECREASING' | 'STABLE';

export type VolumeMetrics = {
  ma20: number;
  current: number;
  ratio: number;
  trend: VolumeTrend;
  spike: boolean;
};

export type AtrResult = {
  atr: number;
  atrPct: number;
};

export type KeyLevel = {
  zoneCenter: number;
  zoneLow: number;
  zoneHigh: number;
  strength: number;
  testCount: number;
  type: 'support' | 'resistance';
};

export type FibLevels = {
  swingLow: number;
  swingHigh: number;
  r236: number;
  r382: number;
  r500: number;
  r618: number;
  r786: number;
  goldenZoneLow: number;
  goldenZoneHigh: number;
  e1272: number;
  e1618: number;
  e2000: number;
};

export type TimeframeData = {
  trend: TrendResult;
  swings: SwingPoint[];
  volume: VolumeMetrics;
  atr: number;
  atrPct: number;
  resistance: KeyLevel[];
  support: KeyLevel[];
  fib: FibLevels | null;
  high52w?: number;
  low52w?: number;
  positionInRange?: number;
};

export type MarketStructure = {
  symbol: string;
  currentPrice: number;
  change24h: number;
  change7d: number;
  timestamp: string;
  weekly: TimeframeData;
  daily: TimeframeData;
  fourHour: TimeframeData;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const SWING_LEFT_BARS = 3;
const SWING_RIGHT_BARS = 3;
const ATR_PERIOD = 14;
const VOLUME_MA_PERIOD = 20;
const VOLUME_SPIKE_THRESHOLD = 1.5;
const VOLUME_INCREASING_FACTOR = 1.15;
const VOLUME_DECREASING_FACTOR = 0.85;
const SR_CLUSTER_PCT = 0.015;
const SR_MIN_TESTS = 2;
const SR_ZONE_WIDTH_PCT = 0.005;
const SR_LOOKBACK = 100;
const FIB_MIN_MAGNITUDE_PCT = 0.05;

// ─── Swing Detection ──────────────────────────────────────────────────────────

function detectSwings(
  candles: Candle[],
  leftBars = SWING_LEFT_BARS,
  rightBars = SWING_RIGHT_BARS
): SwingPoint[] {
  const swings: SwingPoint[] = [];

  for (let i = leftBars; i < candles.length - rightBars; i++) {
    const candle = candles[i]!;

    const leftHighs = candles.slice(i - leftBars, i).map((c) => c.high);
    const rightHighs = candles.slice(i + 1, i + 1 + rightBars).map((c) => c.high);
    const isSwingHigh =
      candle.high > Math.max(...leftHighs) && candle.high > Math.max(...rightHighs);

    if (isSwingHigh) {
      swings.push({
        type: 'high',
        price: candle.high,
        time: candle.openTime ?? new Date(0),
        index: i
      });
    }

    const leftLows = candles.slice(i - leftBars, i).map((c) => c.low);
    const rightLows = candles.slice(i + 1, i + 1 + rightBars).map((c) => c.low);
    const isSwingLow =
      candle.low < Math.min(...leftLows) && candle.low < Math.min(...rightLows);

    if (isSwingLow) {
      swings.push({
        type: 'low',
        price: candle.low,
        time: candle.openTime ?? new Date(0),
        index: i
      });
    }
  }

  return swings.sort((a, b) => a.index - b.index);
}

// ─── Trend Detection ──────────────────────────────────────────────────────────

function detectTrend(swings: SwingPoint[]): TrendResult {
  const highs = swings.filter((s) => s.type === 'high').slice(-6);
  const lows = swings.filter((s) => s.type === 'low').slice(-6);

  let consecutiveHH = 0;
  let consecutiveHL = 0;
  let consecutiveLH = 0;
  let consecutiveLL = 0;

  for (let i = 1; i < highs.length; i++) {
    if (highs[i]!.price > highs[i - 1]!.price) consecutiveHH++;
    else consecutiveHH = 0;
    if (highs[i]!.price < highs[i - 1]!.price) consecutiveLH++;
    else consecutiveLH = 0;
  }

  for (let i = 1; i < lows.length; i++) {
    if (lows[i]!.price > lows[i - 1]!.price) consecutiveHL++;
    else consecutiveHL = 0;
    if (lows[i]!.price < lows[i - 1]!.price) consecutiveLL++;
    else consecutiveLL = 0;
  }

  const isUptrend = consecutiveHH >= 1 && consecutiveHL >= 1;
  const isDowntrend = consecutiveLH >= 1 && consecutiveLL >= 1;

  let direction: TrendDirection = 'SIDEWAYS';
  let strength: TrendStrength = 'WEAK';

  if (isUptrend && !isDowntrend) {
    direction = 'UPTREND';
    const score = Math.min(consecutiveHH, consecutiveHL);
    strength = score >= 3 ? 'STRONG' : score >= 2 ? 'MODERATE' : 'WEAK';
  } else if (isDowntrend && !isUptrend) {
    direction = 'DOWNTREND';
    const score = Math.min(consecutiveLH, consecutiveLL);
    strength = score >= 3 ? 'STRONG' : score >= 2 ? 'MODERATE' : 'WEAK';
  }

  return { direction, strength, consecutiveHH, consecutiveHL };
}

// ─── Volume Analysis ──────────────────────────────────────────────────────────

function analyzeVolume(candles: Candle[]): VolumeMetrics {
  if (candles.length < VOLUME_MA_PERIOD + 1) {
    const current = candles[candles.length - 1]?.volume ?? 0;
    return { ma20: current, current, ratio: 1, trend: 'STABLE', spike: false };
  }

  const recent = candles.slice(-(VOLUME_MA_PERIOD + 1));
  const current = recent[recent.length - 1]?.volume ?? 0;
  const prev20 = recent.slice(0, VOLUME_MA_PERIOD).map((c) => c.volume ?? 0);
  const ma20 = prev20.reduce((a, b) => a + b, 0) / prev20.length;
  const ratio = ma20 > 0 ? current / ma20 : 1;

  const all = candles.slice(-VOLUME_MA_PERIOD);
  const recent5Avg = all.slice(-5).reduce((a, c) => a + (c.volume ?? 0), 0) / 5;
  const prev15Avg = all.slice(0, 15).reduce((a, c) => a + (c.volume ?? 0), 0) / 15;

  let trend: VolumeTrend = 'STABLE';
  if (prev15Avg > 0) {
    if (recent5Avg > prev15Avg * VOLUME_INCREASING_FACTOR) trend = 'INCREASING';
    else if (recent5Avg < prev15Avg * VOLUME_DECREASING_FACTOR) trend = 'DECREASING';
  }

  return {
    ma20: parseFloat(ma20.toFixed(2)),
    current: parseFloat(current.toFixed(2)),
    ratio: parseFloat(ratio.toFixed(2)),
    trend,
    spike: ratio >= VOLUME_SPIKE_THRESHOLD
  };
}

// ─── ATR (14) ─────────────────────────────────────────────────────────────────

function calculateAtrInternal(candles: Candle[], period = ATR_PERIOD): AtrResult {
  if (candles.length < period + 1) {
    return { atr: 0, atrPct: 0 };
  }

  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i]!;
    const prev = candles[i - 1]!;
    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close)
    );
    trs.push(tr);
  }

  const recentTrs = trs.slice(-period);
  const atr = recentTrs.reduce((a, b) => a + b, 0) / recentTrs.length;
  const currentPrice = candles[candles.length - 1]!.close;
  const atrPct = currentPrice > 0 ? (atr / currentPrice) * 100 : 0;

  return {
    atr: parseFloat(atr.toFixed(6)),
    atrPct: parseFloat(atrPct.toFixed(3))
  };
}

// ─── Key Level Detection (S/R) ────────────────────────────────────────────────

function detectKeyLevels(
  candles: Candle[],
  currentPrice: number,
  atr: number
): { support: KeyLevel[]; resistance: KeyLevel[] } {
  const lookback = candles.slice(-SR_LOOKBACK);
  const swings = detectSwings(lookback);

  const prices = swings.map((s) => ({ price: s.price, index: s.index }));

  const visited = new Set<number>();
  const clusters: Array<{ prices: number[]; lastIndex: number }> = [];

  for (let i = 0; i < prices.length; i++) {
    if (visited.has(i)) continue;
    const cluster: number[] = [prices[i]!.price];
    let lastIndex = prices[i]!.index;
    visited.add(i);

    for (let j = i + 1; j < prices.length; j++) {
      if (visited.has(j)) continue;
      const avg = (prices[i]!.price + prices[j]!.price) / 2;
      if (avg > 0 && Math.abs(prices[i]!.price - prices[j]!.price) / avg < SR_CLUSTER_PCT) {
        cluster.push(prices[j]!.price);
        if (prices[j]!.index > lastIndex) lastIndex = prices[j]!.index;
        visited.add(j);
      }
    }

    clusters.push({ prices: cluster, lastIndex });
  }

  const levels: KeyLevel[] = [];

  for (const cluster of clusters) {
    if (cluster.prices.length < SR_MIN_TESTS) continue;

    const zoneCenter = cluster.prices.reduce((a, b) => a + b, 0) / cluster.prices.length;
    const halfWidth = Math.max(SR_ZONE_WIDTH_PCT * zoneCenter, 0.5 * atr);
    const testCount = cluster.prices.length;
    const candlesSinceLastTest = lookback.length - cluster.lastIndex;
    const recencyFactor = Math.max(0, 1.0 - candlesSinceLastTest / 100);
    const strength = Math.min(10, parseFloat((testCount * recencyFactor).toFixed(1)));

    levels.push({
      zoneCenter: parseFloat(zoneCenter.toFixed(6)),
      zoneLow: parseFloat((zoneCenter - halfWidth).toFixed(6)),
      zoneHigh: parseFloat((zoneCenter + halfWidth).toFixed(6)),
      strength,
      testCount,
      type: zoneCenter > currentPrice ? 'resistance' : 'support'
    });
  }

  const support = levels
    .filter((l) => l.type === 'support')
    .sort((a, b) => b.zoneCenter - a.zoneCenter);
  const resistance = levels
    .filter((l) => l.type === 'resistance')
    .sort((a, b) => a.zoneCenter - b.zoneCenter);

  return { support, resistance };
}

// ─── Fibonacci Levels ─────────────────────────────────────────────────────────

function buildFibLevels(swingLow: number, swingHigh: number): FibLevels {
  const range = swingHigh - swingLow;
  const fmt = (v: number) => parseFloat(v.toFixed(6));

  return {
    swingLow: fmt(swingLow),
    swingHigh: fmt(swingHigh),
    r236: fmt(swingHigh - range * 0.236),
    r382: fmt(swingHigh - range * 0.382),
    r500: fmt(swingHigh - range * 0.5),
    r618: fmt(swingHigh - range * 0.618),
    r786: fmt(swingHigh - range * 0.786),
    goldenZoneLow: fmt(swingHigh - range * 0.618),
    goldenZoneHigh: fmt(swingHigh - range * 0.5),
    e1272: fmt(swingHigh + range * 0.272),
    e1618: fmt(swingHigh + range * 0.618),
    e2000: fmt(swingHigh + range * 1.0)
  };
}

function calculateFibLevels(candles: Candle[], trend: TrendResult): FibLevels | null {
  const swings = detectSwings(candles);

  if (trend.direction === 'UPTREND') {
    const lows = swings.filter((s) => s.type === 'low');
    const highs = swings.filter((s) => s.type === 'high');

    for (let hi = highs.length - 1; hi >= 0; hi--) {
      const swingHigh = highs[hi]!;
      const precedingLow = lows
        .filter((l) => l.index < swingHigh.index)
        .sort((a, b) => b.index - a.index)[0];

      if (!precedingLow) continue;

      const range = swingHigh.price - precedingLow.price;
      if (range / precedingLow.price < FIB_MIN_MAGNITUDE_PCT) continue;

      return buildFibLevels(precedingLow.price, swingHigh.price);
    }
  }

  if (trend.direction === 'DOWNTREND') {
    const highs = swings.filter((s) => s.type === 'high');
    const lows = swings.filter((s) => s.type === 'low');

    for (let li = lows.length - 1; li >= 0; li--) {
      const swingLow = lows[li]!;
      const precedingHigh = highs
        .filter((h) => h.index < swingLow.index)
        .sort((a, b) => b.index - a.index)[0];

      if (!precedingHigh) continue;

      const range = precedingHigh.price - swingLow.price;
      if (range / precedingHigh.price < FIB_MIN_MAGNITUDE_PCT) continue;

      return buildFibLevels(swingLow.price, precedingHigh.price);
    }
  }

  const recent = candles.slice(-60);
  const high = Math.max(...recent.map((c) => c.high));
  const low = Math.min(...recent.map((c) => c.low));
  const range = high - low;
  if (range / low >= FIB_MIN_MAGNITUDE_PCT) {
    return buildFibLevels(low, high);
  }

  return null;
}

// ─── 52-Week Range ────────────────────────────────────────────────────────────

function calc52wRange(candles: Candle[]): {
  high52w: number;
  low52w: number;
  positionInRange: number;
} {
  const yearly = candles.slice(-52);
  const high52w = Math.max(...yearly.map((c) => c.high));
  const low52w = Math.min(...yearly.map((c) => c.low));
  const currentPrice = candles[candles.length - 1]!.close;
  const range = high52w - low52w;
  const positionInRange =
    range > 0 ? parseFloat((((currentPrice - low52w) / range) * 100).toFixed(1)) : 50;

  return {
    high52w: parseFloat(high52w.toFixed(6)),
    low52w: parseFloat(low52w.toFixed(6)),
    positionInRange
  };
}

// ─── Build TimeframeData ──────────────────────────────────────────────────────

function buildTimeframeData(
  candles: Candle[],
  currentPrice: number,
  isWeekly = false
): TimeframeData {
  const swings = detectSwings(candles).slice(-10);
  const trend = detectTrend(swings);
  const volume = analyzeVolume(candles);
  const { atr, atrPct } = calculateAtrInternal(candles);
  const { support, resistance } = detectKeyLevels(candles, currentPrice, atr);
  const fib = calculateFibLevels(candles, trend);

  const base: TimeframeData = {
    trend,
    swings,
    volume,
    atr,
    atrPct,
    support,
    resistance,
    fib
  };

  if (isWeekly) {
    const { high52w, low52w, positionInRange } = calc52wRange(candles);
    base.high52w = high52w;
    base.low52w = low52w;
    base.positionInRange = positionInRange;
  }

  return base;
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export function analyzeMarketStructure(
  symbol: string,
  weeklyCandles: Candle[],
  dailyCandles: Candle[],
  fourHourCandles: Candle[]
): MarketStructure {
  const currentPrice = dailyCandles[dailyCandles.length - 1]!.close;

  const prev24h = dailyCandles[dailyCandles.length - 2]?.close ?? currentPrice;
  const change24h =
    prev24h > 0
      ? parseFloat((((currentPrice - prev24h) / prev24h) * 100).toFixed(2))
      : 0;

  const prev7d = dailyCandles[dailyCandles.length - 8]?.close ?? currentPrice;
  const change7d =
    prev7d > 0
      ? parseFloat((((currentPrice - prev7d) / prev7d) * 100).toFixed(2))
      : 0;

  return {
    symbol,
    currentPrice,
    change24h,
    change7d,
    timestamp: new Date().toISOString(),
    weekly: buildTimeframeData(weeklyCandles, currentPrice, true),
    daily: buildTimeframeData(dailyCandles, currentPrice),
    fourHour: buildTimeframeData(fourHourCandles, currentPrice)
  };
}
