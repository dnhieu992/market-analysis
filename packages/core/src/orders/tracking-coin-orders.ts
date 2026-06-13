// ── Types ─────────────────────────────────────────────────────────────────────

export type OrderSigSnapshot = {
  trend: string;
  h4Trend: string;
  m30Trend: string;
  utBotD1Bullish: boolean | null;
  utBotH4Bullish: boolean | null;
  longScore: number | null;
  shortScore: number | null;
  ema200Above: boolean;
  rsi: number | null;
  h4Rsi: number | null;
  swingStructure: string;
};

export type LimitOrderResult = {
  side: 'LONG' | 'SHORT';
  entryLow: number;
  entryHigh: number;
  tp1: number;
  tp2: number | null;
  sl: number;
  rrRatio: number;
  rationale: string;
};

export type OrderEvalResult = {
  activated: boolean;
  outcome: 'tp1' | 'tp2' | 'sl' | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function clusterLevels(levels: number[], threshold = 0.015): number[] {
  if (levels.length === 0) return [];
  const sorted = [...levels].sort((a, b) => a - b);
  const result: number[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const prev = result[result.length - 1]!;
    const curr = sorted[i]!;
    if (Math.abs(curr - prev) / prev > threshold) {
      result.push(curr);
    } else {
      result[result.length - 1] = (prev + curr) / 2;
    }
  }
  return result;
}

function detectSwingLevels(
  highs: number[],
  lows: number[],
  window = 3,
): { highs: number[]; lows: number[] } {
  const rawHighs: number[] = [];
  const rawLows: number[] = [];
  for (let i = window; i < highs.length - window; i++) {
    const localMax = Math.max(...highs.slice(i - window, i + window + 1));
    const localMin = Math.min(...lows.slice(i - window, i + window + 1));
    if (highs[i]! >= localMax) rawHighs.push(highs[i]!);
    if (lows[i]! <= localMin) rawLows.push(lows[i]!);
  }
  return { highs: clusterLevels(rawHighs), lows: clusterLevels(rawLows) };
}

function determineSide(
  tf: 'D1' | 'H4',
  sig: OrderSigSnapshot | null,
): 'LONG' | 'SHORT' {
  if (!sig) return 'LONG';
  if (tf === 'D1') {
    const ls = sig.longScore ?? 0;
    const ss = sig.shortScore ?? 0;
    if (ls !== ss) return ls > ss ? 'LONG' : 'SHORT';
    if (sig.utBotD1Bullish != null) return sig.utBotD1Bullish ? 'LONG' : 'SHORT';
    const t = sig.trend.toLowerCase();
    return t.includes('up') ? 'LONG' : 'SHORT';
  }
  if (sig.utBotH4Bullish != null) return sig.utBotH4Bullish ? 'LONG' : 'SHORT';
  const t = sig.h4Trend.toLowerCase();
  if (t.includes('up')) return 'LONG';
  if (t.includes('down')) return 'SHORT';
  const t30 = sig.m30Trend.toLowerCase();
  return t30.includes('up') ? 'LONG' : 'SHORT';
}

function buildRationale(
  side: 'LONG' | 'SHORT',
  tf: 'D1' | 'H4',
  sig: OrderSigSnapshot | null,
): string {
  const base = side === 'LONG' ? 'Entry tại vùng hỗ trợ' : 'Entry tại vùng kháng cự';
  if (!sig) return `${base}.`;
  const parts: string[] = [];
  if (tf === 'D1') {
    parts.push(`D1 ${sig.trend}`);
    if (sig.utBotD1Bullish === true)  parts.push('UT Bot D1 bullish');
    if (sig.utBotD1Bullish === false) parts.push('UT Bot D1 bearish');
    if (side === 'LONG' && sig.ema200Above)  parts.push('trên EMA200');
    if (side === 'SHORT' && !sig.ema200Above) parts.push('dưới EMA200');
    if (sig.rsi != null && side === 'LONG'  && sig.rsi < 40) parts.push(`RSI (${Math.round(sig.rsi)})`);
    if (sig.rsi != null && side === 'SHORT' && sig.rsi > 65) parts.push(`RSI (${Math.round(sig.rsi)})`);
    if (sig.swingStructure) parts.push(`swing ${sig.swingStructure}`);
  } else {
    parts.push(`H4 ${sig.h4Trend}`);
    if (sig.utBotH4Bullish === true)  parts.push('UT Bot H4 bullish');
    if (sig.utBotH4Bullish === false) parts.push('UT Bot H4 bearish');
    if (sig.m30Trend) parts.push(`M30 ${sig.m30Trend}`);
    if (sig.h4Rsi != null && side === 'LONG'  && sig.h4Rsi < 40) parts.push(`H4 RSI (${Math.round(sig.h4Rsi)})`);
    if (sig.h4Rsi != null && side === 'SHORT' && sig.h4Rsi > 65) parts.push(`H4 RSI (${Math.round(sig.h4Rsi)})`);
  }
  return `${base}. ${parts.filter(Boolean).join(', ')}.`;
}

// ── Order computation ─────────────────────────────────────────────────────────

// Swing: H4 levels within 3% — target 2–5 ngày
export function computeSwingLimitOrder(
  currentPrice: number,
  h4Highs: number[],
  h4Lows: number[],
  sig: OrderSigSnapshot | null,
): LimitOrderResult {
  const { highs, lows } = detectSwingLevels(h4Highs, h4Lows, 3);
  const side = determineSide('D1', sig);
  const rationale = buildRationale(side, 'D1', sig);

  if (side === 'LONG') {
    const supports    = lows.filter(l => l < currentPrice * 0.999 && l > currentPrice * 0.97).sort((a, b) => b - a);
    const resistances = highs.filter(h => h > currentPrice * 1.001 && h < currentPrice * 1.06).sort((a, b) => a - b);
    const pivot    = supports[0] ?? currentPrice * 0.98;
    const entryLow = pivot * 0.995;
    const entryHigh = pivot * 1.005;
    const entryMid = (entryLow + entryHigh) / 2;
    const tp1      = resistances[0] ?? currentPrice * 1.04;
    const tp2      = resistances[1] ?? null;
    const sl       = Math.min(supports[1] ?? entryLow * 0.988, entryLow * 0.992);
    const rrRatio  = Math.max((tp1 - entryMid) / (entryMid - sl), 0.1);
    return { side, entryLow, entryHigh, tp1, tp2, sl, rrRatio, rationale };
  }

  const resistances = highs.filter(h => h > currentPrice * 1.001 && h < currentPrice * 1.03).sort((a, b) => a - b);
  const supports    = lows.filter(l => l < currentPrice * 0.999 && l > currentPrice * 0.94).sort((a, b) => b - a);
  const pivot    = resistances[0] ?? currentPrice * 1.02;
  const entryLow = pivot * 0.995;
  const entryHigh = pivot * 1.005;
  const entryMid = (entryLow + entryHigh) / 2;
  const tp1      = supports[0] ?? currentPrice * 0.96;
  const tp2      = supports[1] ?? null;
  const sl       = Math.max(resistances[1] ?? entryHigh * 1.012, entryHigh * 1.008);
  const rrRatio  = Math.max((entryMid - tp1) / (sl - entryMid), 0.1);
  return { side, entryLow, entryHigh, tp1, tp2, sl, rrRatio, rationale };
}

// Day trade: H1 levels within 1.5% — target trong ngày
export function computeDayTradeLimitOrder(
  currentPrice: number,
  h1Highs: number[],
  h1Lows: number[],
  sig: OrderSigSnapshot | null,
): LimitOrderResult {
  const { highs, lows } = detectSwingLevels(h1Highs, h1Lows, 2);
  const side = determineSide('H4', sig);
  const rationale = buildRationale(side, 'H4', sig);

  if (side === 'LONG') {
    const supports    = lows.filter(l => l < currentPrice * 0.999 && l > currentPrice * 0.985).sort((a, b) => b - a);
    const resistances = highs.filter(h => h > currentPrice * 1.001 && h < currentPrice * 1.025).sort((a, b) => a - b);
    const pivot    = supports[0] ?? currentPrice * 0.991;
    const entryLow = pivot * 0.998;
    const entryHigh = pivot * 1.002;
    const entryMid = (entryLow + entryHigh) / 2;
    const tp1      = resistances[0] ?? currentPrice * 1.015;
    const tp2      = resistances[1] ?? null;
    const sl       = Math.min(supports[1] ?? entryLow * 0.994, entryLow * 0.995);
    const rrRatio  = Math.max((tp1 - entryMid) / (entryMid - sl), 0.1);
    return { side, entryLow, entryHigh, tp1, tp2, sl, rrRatio, rationale };
  }

  const resistances = highs.filter(h => h > currentPrice * 1.001 && h < currentPrice * 1.015).sort((a, b) => a - b);
  const supports    = lows.filter(l => l < currentPrice * 0.999 && l > currentPrice * 0.975).sort((a, b) => b - a);
  const pivot    = resistances[0] ?? currentPrice * 1.009;
  const entryLow = pivot * 0.998;
  const entryHigh = pivot * 1.002;
  const entryMid = (entryLow + entryHigh) / 2;
  const tp1      = supports[0] ?? currentPrice * 0.985;
  const tp2      = supports[1] ?? null;
  const sl       = Math.max(resistances[1] ?? entryHigh * 1.006, entryHigh * 1.005);
  const rrRatio  = Math.max((entryMid - tp1) / (sl - entryMid), 0.1);
  return { side, entryLow, entryHigh, tp1, tp2, sl, rrRatio, rationale };
}

// ── Evaluation ────────────────────────────────────────────────────────────────

// Kiểm tra lệnh limit có được kích hoạt và kết quả TP/SL
// candleHighs/Lows là các nến SAU khi lệnh được đặt
export function evaluateLimitOrder(
  side: 'LONG' | 'SHORT',
  entryLow: number,
  entryHigh: number,
  tp1: number,
  tp2: number | null,
  sl: number,
  candleHighs: number[],
  candleLows: number[],
): OrderEvalResult {
  let activated = false;
  let outcome: 'tp1' | 'tp2' | 'sl' | null = null;

  for (let i = 0; i < candleHighs.length; i++) {
    const h = candleHighs[i]!;
    const l = candleLows[i]!;

    if (!activated) {
      if (side === 'LONG'  && l <= entryHigh) activated = true;
      if (side === 'SHORT' && h >= entryLow)  activated = true;
    }

    if (activated) {
      if (side === 'LONG') {
        // SL first (conservative)
        if (l <= sl)                          { outcome = 'sl';  break; }
        if (tp2 != null && h >= tp2)          { outcome = 'tp2'; break; }
        if (h >= tp1)                         { outcome = 'tp1'; break; }
      } else {
        if (h >= sl)                          { outcome = 'sl';  break; }
        if (tp2 != null && l <= tp2)          { outcome = 'tp2'; break; }
        if (l <= tp1)                         { outcome = 'tp1'; break; }
      }
    }
  }

  return { activated, outcome };
}
