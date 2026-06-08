import { calculateEma } from '../indicators/ema';
import { calculateRsi } from '../indicators/rsi';
import { calculateVolumeRatio } from '../indicators/volume';

export type SmallCapStage = 'Breakout' | 'Accumulating' | 'Waking' | 'Extended' | 'Quiet';

export type SmallCapSignalResult = {
  rsi: number;
  volMultiplier: number;
  ema34Above: boolean;
  ema89Above: boolean;
  ema200Above: boolean;
  stage: SmallCapStage;
  signalScore: number;
  sparkline: number[];
};

export function computeSmallCapSignal(
  closes: number[],
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

  const sparkline = closes.slice(-30).map((v) => Number(v.toFixed(8)));

  const stage = classifyStage({ rsi, volMultiplier, ema34Above, ema89Above, ema200Above });
  const signalScore = computeScore({ rsi, volMultiplier, ema34Above, ema89Above, ema200Above });

  return { rsi, volMultiplier, ema34Above, ema89Above, ema200Above, stage, signalScore, sparkline };
}

function classifyStage(p: {
  rsi: number;
  volMultiplier: number;
  ema34Above: boolean;
  ema89Above: boolean;
  ema200Above: boolean;
}): SmallCapStage {
  const { rsi, volMultiplier, ema34Above, ema89Above, ema200Above } = p;

  // Extended: already overheated — warn user to avoid chasing
  if (rsi > 70 || (ema34Above && ema89Above && ema200Above && rsi > 68 && volMultiplier >= 1.5)) {
    return 'Extended';
  }

  // Breakout: clean momentum entry
  if (ema34Above && volMultiplier >= 2 && rsi >= 30 && rsi <= 65) {
    return 'Breakout';
  }

  // Accumulating: basing pattern, vol starting to tick
  if (!ema34Above && rsi >= 25 && rsi <= 50 && volMultiplier >= 0.7) {
    return 'Accumulating';
  }

  // Waking: 1–2 early signals
  if (ema34Above || volMultiplier >= 1.2 || (rsi >= 40 && rsi <= 62)) {
    return 'Waking';
  }

  return 'Quiet';
}

function computeScore(p: {
  rsi: number;
  volMultiplier: number;
  ema34Above: boolean;
  ema89Above: boolean;
  ema200Above: boolean;
}): number {
  const { rsi, volMultiplier, ema34Above, ema89Above, ema200Above } = p;

  let score = 50;

  // Volume bonus (highest weight — dòng tiền là quan trọng nhất)
  if (volMultiplier >= 3) score += 30;
  else if (volMultiplier >= 2) score += 20;
  else if (volMultiplier >= 1.5) score += 12;
  else if (volMultiplier >= 1.0) score += 5;

  // RSI factor: sweet spot 35–60, penalize extremes
  if (rsi >= 35 && rsi <= 55) score += 15;
  else if (rsi > 55 && rsi <= 65) score += 8;
  else if (rsi > 65 && rsi <= 70) score += 0;
  else if (rsi > 70) score -= 25;  // extended
  else if (rsi < 25) score -= 5;   // may still be falling
  else score += 5;                  // 25–35: accumulation zone

  // EMA position bonus
  if (ema34Above) score += 8;
  if (ema89Above) score += 5;
  if (ema200Above) score += 3;

  // Extended penalty: high vol + high RSI = already pumped
  if (rsi > 70 && volMultiplier >= 2) score -= 15;

  return Math.max(0, Math.min(100, Math.round(score)));
}
