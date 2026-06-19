import { calculateEma } from '../indicators/ema';
import { calculateRsi } from '../indicators/rsi';
import { calculateVolumeRatio } from '../indicators/volume';

export type SmallCapStage = 'Breakout' | 'Trending' | 'Accumulating' | 'Waking' | 'Extended' | 'Quiet';
export type PaTrend = 'StrongUp' | 'Up' | 'Neutral' | 'Down' | 'StrongDown';
export type SwingStructure = 'HH_HL' | 'HH_LL' | 'LH_HL' | 'LH_LL' | 'Mixed';

export type SmallCapSignalResult = {
  rsi: number;
  volMultiplier: number;
  ema34Above: boolean;
  ema89Above: boolean;
  ema200Above: boolean;
  stage: SmallCapStage;
  signalScore: number;
  /** % distance of last close above (or below) EMA34 — overheat/extension gauge for exit timing */
  extPct: number;
  sparkline: number[];
  trend: PaTrend;
  swingStructure: SwingStructure;
};

export function computeTimeframeTrend(
  closes: number[],
  highs: number[],
  lows: number[],
): PaTrend {
  if (closes.length < 20) return 'Neutral';
  const ema34 = calculateEma(closes, 34);
  const ema89 = calculateEma(closes, 89);
  return computePaTrend(closes, highs, lows, ema34, ema89).trend;
}

export function computeSmallCapSignal(
  closes: number[],
  highs: number[],
  lows: number[],
  volumes: number[],
): SmallCapSignalResult | null {
  if (closes.length < 210 || volumes.length < 210) return null;

  const lastClose = closes[closes.length - 1]!;

  const rsi = calculateRsi(closes, 14);
  const ema34 = calculateEma(closes, 34);
  const ema89 = calculateEma(closes, 89);
  const ema200 = calculateEma(closes, 200);
  const volMultiplier = calculateVolumeRatio(volumes, 20);

  const ema34Above = lastClose > ema34;
  const ema89Above = lastClose > ema89;
  const ema200Above = lastClose > ema200;

  // EMA34 slope: compare against EMA34 one candle ago to detect a rising trend
  const ema34Prev = calculateEma(closes.slice(0, -1), 34);
  const ema34Rising = ema34 > ema34Prev;

  // Extension above EMA34, in % — used to separate a healthy trend from an overheated one
  const extPct = Number((((lastClose - ema34) / ema34) * 100).toFixed(1));

  const sparkline = closes.slice(-30).map((v) => Number(v.toFixed(8)));

  const stage = classifyStage({ rsi, volMultiplier, ema34Above, ema89Above, ema200Above, ema34Rising });
  const signalScore = computeScore({ rsi, volMultiplier, ema34Above, ema89Above, ema200Above });
  const { trend, swingStructure } = computePaTrend(closes, highs, lows, ema34, ema89);

  return { rsi, volMultiplier, ema34Above, ema89Above, ema200Above, stage, signalScore, extPct, sparkline, trend, swingStructure };
}

/* ── PA Trend ────────────────────────────────────────────────────────────── */

function findSwingHighs(highs: number[], lookback: number): number[] {
  const result: number[] = [];
  for (let i = lookback; i < highs.length - lookback; i++) {
    let isHigh = true;
    for (let j = 1; j <= lookback; j++) {
      if (highs[i]! <= highs[i - j]! || highs[i]! <= highs[i + j]!) {
        isHigh = false;
        break;
      }
    }
    if (isHigh) result.push(highs[i]!);
  }
  return result;
}

function findSwingLows(lows: number[], lookback: number): number[] {
  const result: number[] = [];
  for (let i = lookback; i < lows.length - lookback; i++) {
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (lows[i]! >= lows[i - j]! || lows[i]! >= lows[i + j]!) {
        isLow = false;
        break;
      }
    }
    if (isLow) result.push(lows[i]!);
  }
  return result;
}

function computePaTrend(
  closes: number[],
  highs: number[],
  lows: number[],
  ema34: number,
  ema89: number,
): { trend: PaTrend; swingStructure: SwingStructure } {
  const lastClose = closes[closes.length - 1]!;

  // Use last 60 candles (exclude current potentially-unclosed candle)
  const window = 60;
  const recentHighs = highs.slice(-(window + 1), -1);
  const recentLows = lows.slice(-(window + 1), -1);

  const LOOKBACK = 3; // 3-bar pivot on daily = solid swing point
  const swingHighs = findSwingHighs(recentHighs, LOOKBACK);
  const swingLows = findSwingLows(recentLows, LOOKBACK);

  let swingStructure: SwingStructure = 'Mixed';

  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    const sh1 = swingHighs[swingHighs.length - 1]!;
    const sh2 = swingHighs[swingHighs.length - 2]!;
    const sl1 = swingLows[swingLows.length - 1]!;
    const sl2 = swingLows[swingLows.length - 2]!;

    const higherHigh = sh1 > sh2;
    const higherLow = sl1 > sl2;

    if (higherHigh && higherLow) swingStructure = 'HH_HL';
    else if (higherHigh && !higherLow) swingStructure = 'HH_LL';
    else if (!higherHigh && higherLow) swingStructure = 'LH_HL';
    else swingStructure = 'LH_LL';
  }

  let trend: PaTrend;

  if (swingStructure === 'HH_HL') {
    trend = lastClose > ema89 ? 'StrongUp' : 'Up';
  } else if (swingStructure === 'LH_LL') {
    trend = lastClose < ema89 ? 'StrongDown' : 'Down';
  } else if (swingStructure === 'HH_LL') {
    // Breakout but losing support — slightly bullish if above ema34
    trend = lastClose > ema34 ? 'Up' : 'Down';
  } else if (swingStructure === 'LH_HL') {
    // Compression — coiling, direction from EMA
    trend = lastClose > ema34 ? 'Neutral' : 'Neutral';
  } else {
    // Mixed — not enough swing points, fall back to EMA
    if (lastClose > ema89) trend = 'Up';
    else if (lastClose < ema89) trend = 'Down';
    else trend = 'Neutral';
  }

  return { trend, swingStructure };
}

/* ── Stage classification ─────────────────────────────────────────────────── */

function classifyStage(p: {
  rsi: number;
  volMultiplier: number;
  ema34Above: boolean;
  ema89Above: boolean;
  ema200Above: boolean;
  ema34Rising: boolean;
}): SmallCapStage {
  const { rsi, volMultiplier, ema34Above, ema89Above, ema200Above, ema34Rising } = p;

  if (rsi > 70 || (ema34Above && ema89Above && ema200Above && rsi > 68 && volMultiplier >= 1.5)) {
    return 'Extended';
  }

  if (ema34Above && volMultiplier >= 2 && rsi >= 30 && rsi <= 65) {
    return 'Breakout';
  }

  // Trending — a confirmed uptrend that grinds up on quiet volume (the ATM case).
  // Price reclaimed both EMA34 & EMA89 with EMA34 sloping up; volume need NOT spike.
  // This is the "hold / trend confirmed" zone, distinct from "Waking" (just stirring).
  if (ema34Above && ema89Above && ema34Rising && rsi >= 50 && rsi <= 68) {
    return 'Trending';
  }

  if (!ema34Above && rsi >= 25 && rsi <= 50 && volMultiplier >= 0.7) {
    return 'Accumulating';
  }

  if (ema34Above || volMultiplier >= 1.2 || (rsi >= 40 && rsi <= 62)) {
    return 'Waking';
  }

  return 'Quiet';
}

/* ── Score ────────────────────────────────────────────────────────────────── */

function computeScore(p: {
  rsi: number;
  volMultiplier: number;
  ema34Above: boolean;
  ema89Above: boolean;
  ema200Above: boolean;
}): number {
  const { rsi, volMultiplier, ema34Above, ema89Above, ema200Above } = p;

  let score = 50;

  if (volMultiplier >= 3) score += 30;
  else if (volMultiplier >= 2) score += 20;
  else if (volMultiplier >= 1.5) score += 12;
  else if (volMultiplier >= 1.0) score += 5;

  if (rsi >= 35 && rsi <= 55) score += 15;
  else if (rsi > 55 && rsi <= 65) score += 8;
  else if (rsi > 65 && rsi <= 70) score += 0;
  else if (rsi > 70) score -= 25;
  else if (rsi < 25) score -= 5;
  else score += 5;

  if (ema34Above) score += 8;
  if (ema89Above) score += 5;
  if (ema200Above) score += 3;

  if (rsi > 70 && volMultiplier >= 2) score -= 15;

  return Math.max(0, Math.min(100, Math.round(score)));
}
