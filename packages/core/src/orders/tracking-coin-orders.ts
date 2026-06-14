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

// ── Tuning constants ────────────────────────────────────────────────────────────
// P1 — volatility-based stops: SL is placed at least k×ATR away from entry so that
// normal market noise does not trigger it. Falls back to a % buffer if ATR is 0.
const ATR_MULT_SWING = 1.6;
const ATR_MULT_DAY = 1.3;
const ATR_FALLBACK_PCT_SWING = 0.018; // 1.8% when ATR unavailable
const ATR_FALLBACK_PCT_DAY = 0.010; // 1.0% when ATR unavailable

// Minimum reward:risk — TP1 is pushed out (toward more reward) until R:R ≥ this.
const MIN_RR_SWING = 1.5;
const MIN_RR_DAY = 1.5;

// P2 — regime gate: if |longScore - shortScore| is below this AND the D1 trend is
// not clearly up/down, the market is treated as range-bound → no trade.
const REGIME_SCORE_MARGIN = 1.0;

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

// P2 — D1 regime: the single source of directional bias. Returns null (= no-trade)
// when the market is range-bound (balanced scores + no clear D1 trend), so the
// caller emits no order instead of forcing a low-quality one.
type D1Regime = { side: 'LONG' | 'SHORT' } | null;

function resolveD1Regime(sig: OrderSigSnapshot | null): D1Regime {
  if (!sig) return null;
  const ls = sig.longScore ?? 0;
  const ss = sig.shortScore ?? 0;
  const gap = Math.abs(ls - ss);
  const t = sig.trend.toLowerCase();
  const trendUp = t.includes('up');
  const trendDown = t.includes('down');

  // Regime gate: scores too close to call AND no clear D1 trend → stay flat.
  if (gap < REGIME_SCORE_MARGIN && !trendUp && !trendDown) return null;

  if (gap >= REGIME_SCORE_MARGIN) return { side: ls > ss ? 'LONG' : 'SHORT' };
  // Scores ambiguous but trend is clear → follow the trend.
  if (trendUp) return { side: 'LONG' };
  if (trendDown) return { side: 'SHORT' };
  return null;
}

// P2 — day-trade direction is slaved to the D1 regime so intraday entries never
// fight the higher-timeframe bias, EXCEPT on a strong H4 reversal (UT Bot flip +
// RSI extreme) which permits a counter-trend scalp.
function resolveDayTradeSide(
  d1: D1Regime,
  sig: OrderSigSnapshot | null,
): { side: 'LONG' | 'SHORT'; counterTrend: boolean } | null {
  if (!d1) return null;
  if (!sig) return { side: d1.side, counterTrend: false };
  const h4Bull = sig.utBotH4Bullish;
  const h4Rsi = sig.h4Rsi;
  if (d1.side === 'LONG' && h4Bull === false && h4Rsi != null && h4Rsi >= 70) {
    return { side: 'SHORT', counterTrend: true };
  }
  if (d1.side === 'SHORT' && h4Bull === true && h4Rsi != null && h4Rsi <= 30) {
    return { side: 'LONG', counterTrend: true };
  }
  return { side: d1.side, counterTrend: false };
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

// Assemble a LONG order from levels + an ATR-sized stop and an R-guaranteed target.
// `slStruct` / `tp1Struct` are the structural support/resistance (may be undefined).
function buildLongOrder(
  side: 'LONG',
  entryLow: number,
  entryHigh: number,
  atrBuffer: number,
  minRr: number,
  slStruct: number | undefined,
  tp1Struct: number,
  tp2Struct: number | undefined,
  rationale: string,
): LimitOrderResult {
  const entryMid = (entryLow + entryHigh) / 2;
  // SL below entry: at least one ATR buffer, deeper if structure sits lower.
  const slAtr = entryLow - atrBuffer;
  const sl = slStruct != null ? Math.min(slStruct, slAtr) : slAtr;
  const risk = Math.max(entryMid - sl, 1e-9);
  // TP pushed out until R:R ≥ minRr (take the further of structure vs R-target).
  const tp1 = Math.max(tp1Struct, entryMid + minRr * risk);
  const tp2 = tp2Struct != null && tp2Struct > tp1 ? tp2Struct : null;
  const rrRatio = Math.max((tp1 - entryMid) / risk, 0.1);
  return { side, entryLow, entryHigh, tp1, tp2, sl, rrRatio, rationale };
}

function buildShortOrder(
  side: 'SHORT',
  entryLow: number,
  entryHigh: number,
  atrBuffer: number,
  minRr: number,
  slStruct: number | undefined,
  tp1Struct: number,
  tp2Struct: number | undefined,
  rationale: string,
): LimitOrderResult {
  const entryMid = (entryLow + entryHigh) / 2;
  const slAtr = entryHigh + atrBuffer;
  const sl = slStruct != null ? Math.max(slStruct, slAtr) : slAtr;
  const risk = Math.max(sl - entryMid, 1e-9);
  const tp1 = Math.min(tp1Struct, entryMid - minRr * risk);
  const tp2 = tp2Struct != null && tp2Struct < tp1 ? tp2Struct : null;
  const rrRatio = Math.max((entryMid - tp1) / risk, 0.1);
  return { side, entryLow, entryHigh, tp1, tp2, sl, rrRatio, rationale };
}

// Swing: H4 levels within 3% — target 2–5 ngày.
// `atr` is the H4 ATR(14); returns null when the D1 regime says no-trade.
export function computeSwingLimitOrder(
  currentPrice: number,
  h4Highs: number[],
  h4Lows: number[],
  sig: OrderSigSnapshot | null,
  atr = 0,
): LimitOrderResult | null {
  const regime = resolveD1Regime(sig);
  if (!regime) return null;
  const side = regime.side;
  const { highs, lows } = detectSwingLevels(h4Highs, h4Lows, 3);
  const rationale = buildRationale(side, 'D1', sig);
  const atrBuffer = atr > 0 ? atr * ATR_MULT_SWING : currentPrice * ATR_FALLBACK_PCT_SWING;

  if (side === 'LONG') {
    const supports    = lows.filter(l => l < currentPrice * 0.999 && l > currentPrice * 0.97).sort((a, b) => b - a);
    const resistances = highs.filter(h => h > currentPrice * 1.001 && h < currentPrice * 1.06).sort((a, b) => a - b);
    const pivot    = supports[0] ?? currentPrice * 0.98;
    const entryLow = pivot * 0.995;
    const entryHigh = pivot * 1.005;
    return buildLongOrder(side, entryLow, entryHigh, atrBuffer, MIN_RR_SWING,
      supports[1], resistances[0] ?? currentPrice * 1.04, resistances[1], rationale);
  }

  const resistances = highs.filter(h => h > currentPrice * 1.001 && h < currentPrice * 1.03).sort((a, b) => a - b);
  const supports    = lows.filter(l => l < currentPrice * 0.999 && l > currentPrice * 0.94).sort((a, b) => b - a);
  const pivot    = resistances[0] ?? currentPrice * 1.02;
  const entryLow = pivot * 0.995;
  const entryHigh = pivot * 1.005;
  return buildShortOrder(side, entryLow, entryHigh, atrBuffer, MIN_RR_SWING,
    resistances[1], supports[0] ?? currentPrice * 0.96, supports[1], rationale);
}

// Day trade: H1 levels within 1.5% — target trong ngày.
// `atr` is the H1 ATR(14); returns null when the D1 regime says no-trade.
export function computeDayTradeLimitOrder(
  currentPrice: number,
  h1Highs: number[],
  h1Lows: number[],
  sig: OrderSigSnapshot | null,
  atr = 0,
): LimitOrderResult | null {
  const dayTrade = resolveDayTradeSide(resolveD1Regime(sig), sig);
  if (!dayTrade) return null;
  const side = dayTrade.side;
  const { highs, lows } = detectSwingLevels(h1Highs, h1Lows, 2);
  let rationale = buildRationale(side, 'H4', sig);
  if (dayTrade.counterTrend) rationale += ' Scalp đảo chiều H4 (RSI cực trị + UT Bot đảo).';
  const atrBuffer = atr > 0 ? atr * ATR_MULT_DAY : currentPrice * ATR_FALLBACK_PCT_DAY;

  if (side === 'LONG') {
    const supports    = lows.filter(l => l < currentPrice * 0.999 && l > currentPrice * 0.985).sort((a, b) => b - a);
    const resistances = highs.filter(h => h > currentPrice * 1.001 && h < currentPrice * 1.025).sort((a, b) => a - b);
    const pivot    = supports[0] ?? currentPrice * 0.991;
    const entryLow = pivot * 0.998;
    const entryHigh = pivot * 1.002;
    return buildLongOrder(side, entryLow, entryHigh, atrBuffer, MIN_RR_DAY,
      supports[1], resistances[0] ?? currentPrice * 1.015, resistances[1], rationale);
  }

  const resistances = highs.filter(h => h > currentPrice * 1.001 && h < currentPrice * 1.015).sort((a, b) => a - b);
  const supports    = lows.filter(l => l < currentPrice * 0.999 && l > currentPrice * 0.975).sort((a, b) => b - a);
  const pivot    = resistances[0] ?? currentPrice * 1.009;
  const entryLow = pivot * 0.998;
  const entryHigh = pivot * 1.002;
  return buildShortOrder(side, entryLow, entryHigh, atrBuffer, MIN_RR_DAY,
    resistances[1], supports[0] ?? currentPrice * 0.985, supports[1], rationale);
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
      // P4: resolve TP/SL only from the candle AFTER the one that filled the entry.
      // Checking SL on the same wick that triggered the entry systematically
      // over-counted SL (a single bar straddling entry+SL was always a loss).
      if (side === 'LONG'  && l <= entryHigh) { activated = true; continue; }
      if (side === 'SHORT' && h >= entryLow)  { activated = true; continue; }
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
