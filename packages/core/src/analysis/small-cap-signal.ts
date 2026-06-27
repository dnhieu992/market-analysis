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
  const ema89 = calculateEma(closes, 89);
  return computePaTrend(closes, highs, lows, ema89).trend;
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
  const { trend, swingStructure } = computePaTrend(closes, highs, lows, ema89);

  return { rsi, volMultiplier, ema34Above, ema89Above, ema200Above, stage, signalScore, extPct, sparkline, trend, swingStructure };
}

/* ── PA Trend ────────────────────────────────────────────────────────────── */

/**
 * Swing-structure trend, ported from the daily-plan engine the user validated
 * as accurate (`apps/worker/.../market/utils/trend.ts` `detectTrend`):
 *
 *  - 1-bar pivots over the FULL series (a candle whose high/low tops/bottoms
 *    both immediate neighbours). Less lag than a 3-bar pivot, and the current
 *    unclosed candle is naturally excluded (it has no "next").
 *  - Compare the last two swing highs and last two swing lows:
 *    HH+HL → bullish, LH+LL → bearish, anything else → neutral.
 *
 * We keep the dashboard's 5-level display (↑↑/↑/→/↓/↓↓) by overlaying EMA89:
 * bullish above EMA89 = StrongUp (else Up); bearish below EMA89 = StrongDown
 * (else Down); neutral structure = Neutral.
 */
function computePaTrend(
  closes: number[],
  highs: number[],
  lows: number[],
  ema89: number,
): { trend: PaTrend; swingStructure: SwingStructure } {
  const lastClose = closes[closes.length - 1]!;

  const swingHighs: number[] = [];
  const swingLows: number[] = [];
  for (let i = 1; i < highs.length - 1; i++) {
    if (highs[i]! > highs[i - 1]! && highs[i]! > highs[i + 1]!) swingHighs.push(highs[i]!);
    if (lows[i]! < lows[i - 1]! && lows[i]! < lows[i + 1]!) swingLows.push(lows[i]!);
  }

  let swingStructure: SwingStructure = 'Mixed';
  let trend: PaTrend = 'Neutral';

  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    const sh1 = swingHighs[swingHighs.length - 1]!;
    const sh2 = swingHighs[swingHighs.length - 2]!;
    const sl1 = swingLows[swingLows.length - 1]!;
    const sl2 = swingLows[swingLows.length - 2]!;

    // daily-plan compares strictly: equal swings count as neither higher nor lower.
    const higherHigh = sh1 > sh2;
    const higherLow = sl1 > sl2;
    const lowerHigh = sh1 < sh2;
    const lowerLow = sl1 < sl2;

    if (higherHigh && higherLow) {
      swingStructure = 'HH_HL'; // bullish
      trend = lastClose > ema89 ? 'StrongUp' : 'Up';
    } else if (lowerHigh && lowerLow) {
      swingStructure = 'LH_LL'; // bearish
      trend = lastClose < ema89 ? 'StrongDown' : 'Down';
    } else {
      // mixed / equal swings → no clean directional structure → neutral
      swingStructure = higherHigh ? 'HH_LL' : lowerHigh ? 'LH_HL' : 'Mixed';
      trend = 'Neutral';
    }
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
