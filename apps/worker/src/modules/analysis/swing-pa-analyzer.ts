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
  type: 'break-retest' | 'pullback-hl' | 'liquidity-sweep' | 'limit-support' | 'limit-resistance' | null;
  entryType: 'market' | 'limit';
  direction: 'long' | 'short' | null;
  confidence: 'high' | 'medium' | 'low';
  limitPrice: number | null;
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

export type FibLevel = {
  ratio: number;
  price: number;
  type: 'retracement' | 'extension';
};

export type SwingPaAnalysis = {
  symbol: string;
  currentPrice: number;
  trend: SwingTrend;
  weeklyTrend: SwingTrend;
  swingHighs: number[];
  swingLows: number[];
  consecutiveHhCount: number;
  consecutiveHlCount: number;
  srZones: SRZone[];
  choch: ChochSignal;
  setup: SwingSetup;
  pendingLimitSetups: SwingSetup[];
  avgVolume20: number;
  fibPivot: { high: number; low: number } | null;
  fibLevels: FibLevel[];
  invalidationLevel: number | null;
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
  // Collect all swing price levels regardless of high/low origin
  const allPrices = [
    ...findSwingHighPrices(weeklyCandles),
    ...findSwingLowPrices(weeklyCandles),
  ];

  // Cluster prices that are within SR_CLUSTER_TOL of each other
  const clusters: { price: number; touches: number }[] = [];
  for (const p of allPrices) {
    const found = clusters.find((c) => Math.abs(c.price - p) / p < SR_CLUSTER_TOL);
    if (found) {
      // Update cluster midpoint to weighted average
      found.price   = (found.price * found.touches + p) / (found.touches + 1);
      found.touches += 1;
    } else {
      clusters.push({ price: p, touches: 1 });
    }
  }

  // Classify each cluster by its position relative to current price (NOT by origin)
  // Zone sitting at current price (within 0.3%) is skipped — not actionable
  return clusters
    .filter((c) => {
      const dist = Math.abs(c.price - currentPrice) / currentPrice;
      return dist > 0.003 && dist <= 0.30;
    })
    .map((c) => ({
      low:      c.price * (1 - SR_ZONE_HALF),
      high:     c.price * (1 + SR_ZONE_HALF),
      midpoint: c.price,
      touches:  c.touches,
      role:     (c.price > currentPrice ? 'resistance' : 'support') as 'support' | 'resistance',
    }))
    .sort((a, b) => Math.abs(a.midpoint - currentPrice) - Math.abs(b.midpoint - currentPrice))
    .slice(0, 6);
}

// ── Volume ────────────────────────────────────────────────────────────────────

export function calcAvgVolume(candles: Candle[], period = 20): number {
  const slice = candles.slice(-period);
  if (slice.length === 0) return 0;
  return slice.reduce((s, c) => s + (c.volume ?? 0), 0) / slice.length;
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

// ── Trade helpers ─────────────────────────────────────────────────────────────

function calcRR(entry: number, sl: number, tp1: number): number {
  const risk   = Math.abs(entry - sl);
  const reward = Math.abs(tp1 - entry);
  return risk === 0 ? 0 : reward / risk;
}

/** Nearest resistance zone or swing high that is strictly ABOVE currentPrice */
function findTp1Long(
  currentPrice: number,
  srZones: SRZone[],
  swingHighs: number[],
  fibLevels: FibLevel[]
): number {
  const res = srZones
    .filter((z) => z.role === 'resistance' && z.midpoint > currentPrice)
    .sort((a, b) => a.midpoint - b.midpoint)[0];
  if (res) return res.midpoint;

  const sh = swingHighs.filter((h) => h > currentPrice).sort((a, b) => a - b)[0];
  if (sh) return sh;

  const ext = fibLevels
    .filter((l) => l.type === 'extension' && l.price > currentPrice)
    .sort((a, b) => a.price - b.price)[0];
  if (ext) return ext.price;

  return currentPrice * 1.05;
}

/** Nearest support zone or swing low that is strictly BELOW currentPrice */
function findTp1Short(
  currentPrice: number,
  srZones: SRZone[],
  swingLows: number[]
): number {
  const sup = srZones
    .filter((z) => z.role === 'support' && z.midpoint < currentPrice)
    .sort((a, b) => b.midpoint - a.midpoint)[0];
  if (sup) return sup.midpoint;

  const sl = swingLows.filter((l) => l < currentPrice).sort((a, b) => b - a)[0];
  if (sl) return sl;

  return currentPrice * 0.95;
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

      const highVolBreak = (c.volume ?? 0) > avgVol;
      const h4Pattern    = detect4HPattern(h4Candles, trend);
      const direction: 'long' | 'short' = brokeBullish ? 'long' : 'short';

      const confidence: 'high' | 'medium' | 'low' =
        highVolBreak && h4Pattern !== null ? 'high' :
        highVolBreak || h4Pattern !== null ? 'medium' : 'low';

      return {
        type: 'break-retest',
        entryType: 'market',
        direction,
        confidence,
        limitPrice: null,
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
  consecutiveHlCount: number,
  fibLevels: FibLevel[]
): SwingSetup | null {
  if (trend === 'sideway') return null;
  // Require strong trend: at least 3 consecutive HH (or HL)
  if (consecutiveHhCount < 3 && consecutiveHlCount < 3) return null;

  const current = dailyCandles[dailyCandles.length - 1]!;
  const last3   = dailyCandles.slice(-3);
  const volDeclining = last3.length === 3
    && (last3[2]!.volume ?? 0) < (last3[1]!.volume ?? 0)
    && (last3[1]!.volume ?? 0) < (last3[0]!.volume ?? 0);

  if (trend === 'uptrend' && swingLows.length >= 1) {
    const lastHl    = swingLows[swingLows.length - 1]!;
    if (Math.abs(current.close - lastHl) / lastHl > 0.03) return null;

    const confluence = srZones.find((z) => Math.abs(z.midpoint - lastHl) / lastHl < 0.02);
    const fibConf    = findFibConfluence(lastHl, fibLevels);
    const golden     = fibConf ? isGoldenZone(fibConf) : false;

    const factors    = [volDeclining, !!confluence, !!fibConf].filter(Boolean).length;
    const confidence: 'high' | 'medium' | 'low' =
      golden || factors >= 2 ? 'high' : factors >= 1 ? 'medium' : 'low';

    const tp1Long = findTp1Long(current.close, srZones, swingHighs, fibLevels);
    return {
      type: 'pullback-hl',
      entryType: 'market',
      direction: 'long',
      confidence,
      limitPrice: null,
      entryZone: [lastHl * 0.99, lastHl * 1.01],
      stopLoss:  lastHl * 0.985,
      tp1:       tp1Long,
      tp2:       null,
      notes: [
        `Pullback to last HL: ${fmtPrice(lastHl)}`,
        volDeclining ? 'Volume declining in pullback ✅' : 'Volume not declining ⚠️',
        confluence ? `S/R confluence at ${fmtPrice(confluence.midpoint)} ✅` : 'No S/R confluence ⚠️',
        fibConf
          ? `Fib ${fibConf.ratio} confluence ✅${golden ? ' 🔑 Golden Zone' : ''}`
          : 'No Fibonacci confluence ⚠️',
      ],
    };
  }

  if (trend === 'downtrend' && swingHighs.length >= 1) {
    const lastLh    = swingHighs[swingHighs.length - 1]!;
    if (Math.abs(current.close - lastLh) / lastLh > 0.03) return null;

    const confluence = srZones.find((z) => Math.abs(z.midpoint - lastLh) / lastLh < 0.02);
    const fibConf    = findFibConfluence(lastLh, fibLevels);
    const golden     = fibConf ? isGoldenZone(fibConf) : false;

    const factors    = [volDeclining, !!confluence, !!fibConf].filter(Boolean).length;
    const confidence: 'high' | 'medium' | 'low' =
      golden || factors >= 2 ? 'high' : factors >= 1 ? 'medium' : 'low';

    const tp1Short = findTp1Short(current.close, srZones, swingLows);
    return {
      type: 'pullback-hl',
      entryType: 'market',
      direction: 'short',
      confidence,
      limitPrice: null,
      entryZone: [lastLh * 0.99, lastLh * 1.01],
      stopLoss:  lastLh * 1.015,
      tp1:       tp1Short,
      tp2:       null,
      notes: [
        `Pullback to last LH: ${fmtPrice(lastLh)}`,
        volDeclining ? 'Volume declining in pullback ✅' : 'Volume not declining ⚠️',
        confluence ? `S/R confluence at ${fmtPrice(confluence.midpoint)} ✅` : 'No S/R confluence ⚠️',
        fibConf
          ? `Fib ${fibConf.ratio} confluence ✅${golden ? ' 🔑 Golden Zone' : ''}`
          : 'No Fibonacci confluence ⚠️',
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
  const volSpike  = (current.volume ?? 0) > avgVol * 1.5;

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
        entryType: 'market',
        direction: 'long',
        confidence: volSpike ? 'high' : 'medium',
        limitPrice: null,
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
        entryType: 'market',
        direction: 'short',
        confidence: volSpike ? 'high' : 'medium',
        limitPrice: null,
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

// ── Deduplication ─────────────────────────────────────────────────────────────
// Merge setups of the same direction whose limit prices are within 2% of each
// other.  Keep the higher-confidence one; combine notes to preserve context.

const CONF_RANK: Record<'high' | 'medium' | 'low', number> = { high: 3, medium: 2, low: 1 };

function deduplicateSetups(setups: SwingSetup[]): SwingSetup[] {
  const result: SwingSetup[] = [];
  for (const s of setups) {
    const dup = result.find(
      (r) =>
        r.direction === s.direction &&
        r.limitPrice !== null &&
        s.limitPrice !== null &&
        Math.abs(r.limitPrice - s.limitPrice) / r.limitPrice < 0.02
    );
    if (!dup) {
      result.push({ ...s });
    } else if (CONF_RANK[s.confidence] > CONF_RANK[dup.confidence]) {
      const idx = result.indexOf(dup);
      // Merge: keep stronger setup, absorb unique notes from the weaker one
      const mergedNotes = [...new Set([...s.notes, ...dup.notes])];
      result[idx] = { ...s, notes: mergedNotes };
    }
    // else keep existing dup — it already has equal or better confidence
  }
  return result;
}

// ── Pending Limit Setups ──────────────────────────────────────────────────────
//
// When no active market setup exists, generate limit order plans at key S/R
// zones and swing levels that price hasn't reached yet.

function detectPendingLimitSetups(
  currentPrice: number,
  trend: SwingTrend,
  swingHighs: number[],
  swingLows: number[],
  srZones: SRZone[],
  fibLevels: FibLevel[]
): SwingSetup[] {
  const results: SwingSetup[] = [];

  // ── Limit Buy setups (support zones below price) ───────────────────────────
  const supportZones = srZones
    .filter((z) => z.role === 'support' && z.midpoint < currentPrice)
    .sort((a, b) => b.midpoint - a.midpoint); // closest first

  for (const zone of supportZones.slice(0, 2)) {
    const distPct  = ((currentPrice - zone.midpoint) / currentPrice) * 100;
    const lastHl   = swingLows.length > 0 ? swingLows[swingLows.length - 1]! : null;
    const hlConf   = lastHl !== null && Math.abs(lastHl - zone.midpoint) / zone.midpoint < 0.02;
    const fibConf  = findFibConfluence(zone.midpoint, fibLevels);
    const golden   = fibConf ? isGoldenZone(fibConf) : false;

    const tp1      = findTp1Long(currentPrice, srZones, swingHighs, fibLevels);
    const sl       = zone.low * 0.995;
    const rr       = calcRR(zone.midpoint, sl, tp1);

    const confCount = [hlConf, !!fibConf, zone.touches >= 2, golden].filter(Boolean).length;
    const confidence: 'high' | 'medium' | 'low' =
      rr < 1.5 ? 'low' :
      (confCount >= 3 || (golden && rr >= 2.0)) ? 'high' :
      confCount >= 2 ? 'medium' : 'low';

    results.push({
      type: 'limit-support',
      entryType: 'limit',
      direction: 'long',
      confidence,
      limitPrice: zone.midpoint,
      entryZone: [zone.low, zone.high],
      stopLoss:  sl,
      tp1,
      tp2:       null,
      notes: [
        `Support zone: $${fmtPrice(zone.low)} – $${fmtPrice(zone.high)}`,
        `${distPct.toFixed(1)}% below current price`,
        `Tested ${zone.touches}x on weekly chart`,
        hlConf ? 'Confluence with last HL ✅' : 'No HL confluence at this zone',
        fibConf
          ? `Fib ${fibConf.ratio} confluence ✅${golden ? ' 🔑 Golden Zone' : ''}`
          : 'No Fibonacci confluence',
        `R:R = 1:${rr.toFixed(2)}${rr >= 2 ? ' ✅' : rr >= 1.5 ? ' ⚠️' : ' ❌'}`,
        trend === 'uptrend' ? 'Trend aligned: UPTREND ✅' : trend === 'sideway' ? 'Sideway — watch for bounce' : 'Counter-trend ⚠️',
      ],
    });
  }

  // ── Limit Sell setups (resistance zones above price) ──────────────────────
  const resistanceZones = srZones
    .filter((z) => z.role === 'resistance' && z.midpoint > currentPrice)
    .sort((a, b) => a.midpoint - b.midpoint); // closest first

  for (const zone of resistanceZones.slice(0, 2)) {
    const distPct  = ((zone.midpoint - currentPrice) / currentPrice) * 100;
    const lastLh   = swingHighs.length > 0 ? swingHighs[swingHighs.length - 1]! : null;
    const lhConf   = lastLh !== null && Math.abs(lastLh - zone.midpoint) / zone.midpoint < 0.02;
    const fibConf  = findFibConfluence(zone.midpoint, fibLevels);
    const golden   = fibConf ? isGoldenZone(fibConf) : false;

    const tp1      = findTp1Short(currentPrice, srZones, swingLows);
    const sl       = zone.high * 1.005;
    const rr       = calcRR(zone.midpoint, sl, tp1);

    const confCount = [lhConf, !!fibConf, zone.touches >= 2, golden].filter(Boolean).length;
    const confidence: 'high' | 'medium' | 'low' =
      rr < 1.5 ? 'low' :
      (confCount >= 3 || (golden && rr >= 2.0)) ? 'high' :
      confCount >= 2 ? 'medium' : 'low';

    results.push({
      type: 'limit-resistance',
      entryType: 'limit',
      direction: 'short',
      confidence,
      limitPrice: zone.midpoint,
      entryZone: [zone.low, zone.high],
      stopLoss:  sl,
      tp1,
      tp2:       null,
      notes: [
        `Resistance zone: $${fmtPrice(zone.low)} – $${fmtPrice(zone.high)}`,
        `${distPct.toFixed(1)}% above current price`,
        `Tested ${zone.touches}x on weekly chart`,
        lhConf ? 'Confluence with last LH ✅' : 'No LH confluence at this zone',
        fibConf
          ? `Fib ${fibConf.ratio} confluence ✅${golden ? ' 🔑 Golden Zone' : ''}`
          : 'No Fibonacci confluence',
        `R:R = 1:${rr.toFixed(2)}${rr >= 2 ? ' ✅' : rr >= 1.5 ? ' ⚠️' : ' ❌'}`,
        trend === 'downtrend' ? 'Trend aligned: DOWNTREND ✅' : trend === 'sideway' ? 'Sideway — watch for rejection' : 'Counter-trend ⚠️',
      ],
    });
  }

  // ── HL/LH swing levels (if not already covered by S/R zones) ─────────────
  if (trend === 'uptrend' && swingLows.length >= 1) {
    const lastHl   = swingLows[swingLows.length - 1]!;
    const alreadyCovered = results.some(
      (s) => s.entryZone && Math.abs(s.entryZone[0] - lastHl) / lastHl < 0.01
    );
    if (!alreadyCovered && lastHl < currentPrice) {
      const distPct = ((currentPrice - lastHl) / currentPrice) * 100;
      const tp1hl   = findTp1Long(currentPrice, srZones, swingHighs, fibLevels);
      const sl      = lastHl * 0.985;
      const rr      = calcRR(lastHl, sl, tp1hl);
      const fibConf = findFibConfluence(lastHl, fibLevels);
      const golden  = fibConf ? isGoldenZone(fibConf) : false;
      results.unshift({
        type: 'limit-support',
        entryType: 'limit',
        direction: 'long',
        confidence: rr < 1.5 ? 'low' : golden ? 'high' : 'medium',
        limitPrice: lastHl,
        entryZone: [lastHl * 0.99, lastHl * 1.01],
        stopLoss:  sl,
        tp1:       tp1hl,
        tp2:       null,
        notes: [
          `Last Higher Low: $${fmtPrice(lastHl)}`,
          `${distPct.toFixed(1)}% below current price`,
          fibConf ? `Fib ${fibConf.ratio} confluence ✅${golden ? ' 🔑 Golden Zone' : ''}` : 'No Fibonacci confluence',
          `R:R = 1:${rr.toFixed(2)}${rr >= 2 ? ' ✅' : rr >= 1.5 ? ' ⚠️' : ' ❌'}`,
          'Uptrend aligned ✅',
        ],
      });
    }
  }

  if (trend === 'downtrend' && swingHighs.length >= 1) {
    const lastLh   = swingHighs[swingHighs.length - 1]!;
    const alreadyCovered = results.some(
      (s) => s.entryZone && Math.abs(s.entryZone[0] - lastLh) / lastLh < 0.01
    );
    if (!alreadyCovered && lastLh > currentPrice) {
      const distPct = ((lastLh - currentPrice) / currentPrice) * 100;
      const tp1lh   = findTp1Short(currentPrice, srZones, swingLows);
      const sl      = lastLh * 1.015;
      const rr      = calcRR(lastLh, sl, tp1lh);
      const fibConf = findFibConfluence(lastLh, fibLevels);
      const golden  = fibConf ? isGoldenZone(fibConf) : false;
      results.unshift({
        type: 'limit-resistance',
        entryType: 'limit',
        direction: 'short',
        confidence: rr < 1.5 ? 'low' : golden ? 'high' : 'medium',
        limitPrice: lastLh,
        entryZone: [lastLh * 0.99, lastLh * 1.01],
        stopLoss:  sl,
        tp1:       tp1lh,
        tp2:       null,
        notes: [
          `Last Lower High: $${fmtPrice(lastLh)}`,
          `${distPct.toFixed(1)}% above current price`,
          fibConf ? `Fib ${fibConf.ratio} confluence ✅${golden ? ' 🔑 Golden Zone' : ''}` : 'No Fibonacci confluence',
          `R:R = 1:${rr.toFixed(2)}${rr >= 2 ? ' ✅' : rr >= 1.5 ? ' ⚠️' : ' ❌'}`,
          'Downtrend aligned ✅',
        ],
      });
    }
  }

  // ── Fibonacci-only setups (golden zone not covered by S/R or HL) ─────────
  const GOLDEN_RATIOS = [0.618, 0.5];
  const retraceLevels = fibLevels.filter((l) => l.type === 'retracement');

  for (const ratio of GOLDEN_RATIOS) {
    const fibLevel = retraceLevels.find((l) => l.ratio === ratio);
    if (!fibLevel) continue;

    const isLong  = trend !== 'downtrend' && fibLevel.price < currentPrice;
    const isShort = trend === 'downtrend' && fibLevel.price > currentPrice;
    if (!isLong && !isShort) continue;

    // Skip if already covered by an existing setup within 1.5%
    const covered = results.some(
      (s) => s.limitPrice !== null && Math.abs(s.limitPrice - fibLevel.price) / fibLevel.price < 0.015
    );
    if (covered) continue;

    const distPct = Math.abs(currentPrice - fibLevel.price) / currentPrice * 100;

    if (isLong) {
      const srSupport = srZones.find((z) => z.role === 'support' && Math.abs(z.midpoint - fibLevel.price) / fibLevel.price < 0.02);
      const tp1fib    = findTp1Long(currentPrice, srZones, swingHighs, fibLevels);
      const sl        = fibLevel.price * 0.985;
      const rr        = calcRR(fibLevel.price, sl, tp1fib);
      results.push({
        type: 'limit-support',
        entryType: 'limit',
        direction: 'long',
        confidence: rr < 1.5 ? 'low' : ratio === 0.618 ? 'high' : 'medium',
        limitPrice: fibLevel.price,
        entryZone:  [fibLevel.price * 0.99, fibLevel.price * 1.01],
        stopLoss:   sl,
        tp1:        tp1fib,
        tp2:        null,
        notes: [
          `Fib ${ratio} retracement: $${fmtPrice(fibLevel.price)} 🔑 Golden Zone`,
          `${distPct.toFixed(1)}% below current price`,
          srSupport ? `S/R confluence at $${fmtPrice(srSupport.midpoint)} ✅` : 'No S/R confluence — pure Fibonacci level',
          `R:R = 1:${rr.toFixed(2)}${rr >= 2 ? ' ✅' : rr >= 1.5 ? ' ⚠️' : ' ❌'}`,
          trend === 'uptrend' ? 'Trend aligned: UPTREND ✅' : 'Sideway — watch for bounce',
        ],
      });
    } else {
      const srResist = srZones.find((z) => z.role === 'resistance' && Math.abs(z.midpoint - fibLevel.price) / fibLevel.price < 0.02);
      const tp1fib   = findTp1Short(currentPrice, srZones, swingLows);
      const sl       = fibLevel.price * 1.015;
      const rr       = calcRR(fibLevel.price, sl, tp1fib);
      results.push({
        type: 'limit-resistance',
        entryType: 'limit',
        direction: 'short',
        confidence: rr < 1.5 ? 'low' : ratio === 0.618 ? 'high' : 'medium',
        limitPrice: fibLevel.price,
        entryZone:  [fibLevel.price * 0.99, fibLevel.price * 1.01],
        stopLoss:   sl,
        tp1:        tp1fib,
        tp2:        null,
        notes: [
          `Fib ${ratio} retracement: $${fmtPrice(fibLevel.price)} 🔑 Golden Zone`,
          `${distPct.toFixed(1)}% above current price`,
          srResist ? `S/R confluence at $${fmtPrice(srResist.midpoint)} ✅` : 'No S/R confluence — pure Fibonacci level',
          `R:R = 1:${rr.toFixed(2)}${rr >= 2 ? ' ✅' : rr >= 1.5 ? ' ⚠️' : ' ❌'}`,
          'Trend aligned: DOWNTREND ✅',
        ],
      });
    }
  }

  // ── Deduplicate setups that are too close to each other (<2%) ─────────────
  return deduplicateSetups(results);
}

// ── Fibonacci helpers ─────────────────────────────────────────────────────────

function findFibConfluence(price: number, fibLevels: FibLevel[], tolerancePct = 1.5): FibLevel | null {
  return fibLevels.find((l) => Math.abs(l.price - price) / price * 100 <= tolerancePct) ?? null;
}

function isGoldenZone(fib: FibLevel): boolean {
  return fib.ratio === 0.5 || fib.ratio === 0.618;
}

// ── Fibonacci retracement / extension ────────────────────────────────────────

const FIBO_RETRACE = [0.236, 0.382, 0.5, 0.618, 0.786];
const FIBO_EXT     = [1.272, 1.618];

export function calcFibLevels(
  trend: SwingTrend,
  swingHighs: number[],
  swingLows: number[]
): { pivot: { high: number; low: number } | null; levels: FibLevel[] } {
  if (swingHighs.length === 0 || swingLows.length === 0) {
    return { pivot: null, levels: [] };
  }

  const high  = swingHighs[swingHighs.length - 1]!;
  const low   = swingLows[swingLows.length - 1]!;
  const range = high - low;
  if (range <= 0) return { pivot: null, levels: [] };

  const levels: FibLevel[] = [];

  if (trend !== 'downtrend') {
    // Uptrend / sideway: retracement pulls back from high toward low
    for (const r of FIBO_RETRACE) {
      levels.push({ ratio: r, price: high - range * r, type: 'retracement' });
    }
    for (const r of FIBO_EXT) {
      levels.push({ ratio: r, price: low + range * r, type: 'extension' });
    }
  } else {
    // Downtrend: retracement bounces from low toward high
    for (const r of FIBO_RETRACE) {
      levels.push({ ratio: r, price: low + range * r, type: 'retracement' });
    }
    for (const r of FIBO_EXT) {
      levels.push({ ratio: r, price: high - range * r, type: 'extension' });
    }
  }

  return { pivot: { high, low }, levels };
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

  const weeklyTrend = detectDailyTrend(weeklyCandles).trend;

  const choch   = detectChoch(dailyCandles, trend, swingHighs, swingLows);
  const srZones = extractSRZones(weeklyCandles, currentPrice);

  // Price level that invalidates the current trend structure
  const invalidationLevel: number | null =
    trend === 'uptrend' && swingLows.length >= 1
      ? swingLows[swingLows.length - 1]! * 0.995
      : trend === 'downtrend' && swingHighs.length >= 1
      ? swingHighs[swingHighs.length - 1]! * 1.005
      : null;

  // Fibonacci must be computed before setup detection so it can be used as a confluence factor
  const { pivot: fibPivot, levels: fibLevels } = calcFibLevels(trend, swingHighs, swingLows);

  // Priority: liquidity sweep → break & retest → pullback to HL
  const activeSetup: SwingSetup | null =
    detectLiquiditySweep(dailyCandles, trend, swingHighs, swingLows, avgVol) ??
    detectBreakRetest(dailyCandles, h4Candles, srZones, trend, avgVol) ??
    detectPullbackHl(dailyCandles, trend, swingHighs, swingLows, srZones, consecutiveHhCount, consecutiveHlCount, fibLevels) ??
    null;

  const pendingLimitSetups = detectPendingLimitSetups(currentPrice, trend, swingHighs, swingLows, srZones, fibLevels);

  const setup: SwingSetup = activeSetup ?? {
    type: null,
    entryType: 'market',
    direction: null,
    confidence: 'low',
    limitPrice: null,
    entryZone: null,
    stopLoss: null,
    tp1: null,
    tp2: null,
    notes: ['No active market setup on current candle — see limit setups below'],
  };

  // Fill TP2 from the next S/R zone beyond TP1
  if (setup.tp1 !== null && setup.tp2 === null && setup.direction !== null) {
    const isLong   = setup.direction === 'long';
    const nextZone = isLong
      ? srZones.find((z) => z.midpoint > setup.tp1! && z.role === 'resistance')
      : srZones.find((z) => z.midpoint < setup.tp1! && z.role === 'support');
    if (nextZone) setup.tp2 = nextZone.midpoint;
  }

  // Fill TP2 for limit setups too
  for (const ls of pendingLimitSetups) {
    if (ls.tp1 !== null && ls.tp2 === null && ls.direction !== null) {
      const isLong   = ls.direction === 'long';
      const nextZone = isLong
        ? srZones.find((z) => z.midpoint > ls.tp1! && z.role === 'resistance')
        : srZones.find((z) => z.midpoint < ls.tp1! && z.role === 'support');
      if (nextZone) ls.tp2 = nextZone.midpoint;
    }
  }

  return {
    symbol,
    currentPrice,
    trend,
    weeklyTrend,
    swingHighs,
    swingLows,
    consecutiveHhCount,
    consecutiveHlCount,
    srZones,
    choch,
    setup,
    pendingLimitSetups,
    avgVolume20: avgVol,
    fibPivot,
    fibLevels,
    invalidationLevel,
  };
}
