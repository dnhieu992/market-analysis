/**
 * Chart Lab math, no I/O except Binance klines: pin a chart to its candle, fingerprint the market at
 * that moment (features), score what happened next (outcome) and rank similar charts.
 */

const SPOT = process.env.BINANCE_BASE_URL ?? 'https://api.binance.com';
const FUTURES = 'https://fapi.binance.com';

export type Kline = { t: number; o: number; h: number; l: number; c: number; v: number };

export const INTERVAL_MS: Record<string, number> = {
  '1m': 60_000,
  '3m': 3 * 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 3_600_000,
  '2h': 2 * 3_600_000,
  '4h': 4 * 3_600_000,
  '6h': 6 * 3_600_000,
  '8h': 8 * 3_600_000,
  '12h': 12 * 3_600_000,
  '1d': 86_400_000,
  '3d': 3 * 86_400_000,
  '1w': 7 * 86_400_000,
};

/** Default TP / SL (% from entry) by timeframe, used when the user leaves them empty. */
export function defaultTpSl(interval: string | null | undefined): { tpPct: number; slPct: number } {
  switch (interval) {
    case '1m':
    case '3m':
    case '5m':
      return { tpPct: 0.6, slPct: 0.3 };
    case '15m':
    case '30m':
      return { tpPct: 1, slPct: 0.5 };
    case '1h':
    case '2h':
      return { tpPct: 2, slPct: 1 };
    case '4h':
    case '6h':
    case '8h':
    case '12h':
      return { tpPct: 4, slPct: 2 };
    default:
      return { tpPct: 8, slPct: 4 };
  }
}

/** "H4", "4H", "240", "1 giờ", "D", "1D" … → Binance interval, or null. */
export function normalizeInterval(raw: unknown): string | null {
  if (raw == null) return null;
  let s = String(raw).trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  const minutes: Record<string, string> = { '1': '1m', '3': '3m', '5': '5m', '15': '15m', '30': '30m', '60': '1h', '120': '2h', '240': '4h', '360': '6h', '480': '8h', '720': '12h' };
  const m = minutes[s];
  if (m) return m;
  s = s.replace(/^([hdwm])(\d+)$/, '$2$1'); // h4 → 4h, m15 → 15m
  s = s.replace(/phút|min(ute)?s?$/, 'm').replace(/giờ|hours?|hr?$/, 'h').replace(/ngày|days?$/, 'd').replace(/tuần|weeks?$/, 'w');
  if (s === 'd') s = '1d';
  if (s === 'w') s = '1w';
  if (s === 'h') s = '1h';
  return INTERVAL_MS[s] ? s : null;
}

/** "BTC/USDT", "BTCUSDT.P", "BTC-USDT-SWAP", "BINANCE:ETHUSDT" … → Binance USDT symbol, or null. */
export function normalizeSymbol(raw: unknown): string | null {
  if (raw == null) return null;
  let s = String(raw).trim().toUpperCase();
  if (!s) return null;
  s = s.replace(/^[A-Z]+:/, '').replace(/\.P$/, '').replace(/-?SWAP$/, '').replace(/PERP(ETUAL)?$/, '');
  s = s.replace(/[^A-Z0-9]/g, '');
  if (!s) return null;
  if (s.endsWith('USDC') || s.endsWith('USD')) s = s.replace(/USDC?$/, '');
  if (!s.endsWith('USDT')) s = `${s}USDT`;
  return s.length > 4 ? s : null;
}

type Row = [number, string, string, string, string, string, ...unknown[]];

async function getJson(url: string): Promise<Row[] | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return null;
    return (await r.json()) as Row[];
  } catch {
    return null;
  }
}

/** Klines from Binance spot, else USDT-M futures (coins only listed there). Only CLOSED candles. */
export async function fetchKlines(symbol: string, interval: string, opts: { endTime?: number; startTime?: number; limit?: number }): Promise<Kline[]> {
  const q = new URLSearchParams({ symbol, interval, limit: String(Math.min(opts.limit ?? 500, 1000)) });
  if (opts.endTime != null) q.set('endTime', String(Math.floor(opts.endTime)));
  if (opts.startTime != null) q.set('startTime', String(Math.floor(opts.startTime)));
  const rows = (await getJson(`${SPOT}/api/v3/klines?${q}`)) ?? (await getJson(`${FUTURES}/fapi/v1/klines?${q}`));
  if (!rows) throw new Error(`Không lấy được nến Binance cho ${symbol} ${interval}`);
  const step = INTERVAL_MS[interval] ?? 0;
  const now = Date.now();
  return rows
    .map((r) => ({ t: r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] }))
    .filter((k) => k.t + step <= now);
}

/**
 * Which candle is the chart's last one. Claude gives an approximate time (from the x-axis) and the last
 * close it read; pick the candle near that time whose close matches best. No time → latest closed candle.
 */
export async function resolveChartCandle(
  symbol: string,
  interval: string,
  approxTime: Date | null,
  lastClose: number | null,
): Promise<{ candle: Kline; note: string }> {
  const step = INTERVAL_MS[interval] ?? 3_600_000;
  if (!approxTime || approxTime.getTime() > Date.now() - step) {
    const ks = await fetchKlines(symbol, interval, { limit: 3 });
    const candle = ks[ks.length - 1];
    if (!candle) throw new Error('Không có nến nào');
    return { candle, note: approxTime ? 'Chart đang chạy: lấy nến đã đóng gần nhất' : 'Không đọc được thời gian trên ảnh: lấy nến đã đóng gần nhất' };
  }
  // ±60 candles around the guess (axis labels are coarse).
  const ks = await fetchKlines(symbol, interval, { endTime: approxTime.getTime() + 60 * step, limit: 121 });
  if (!ks.length) throw new Error('Không có nến quanh thời điểm trên chart');
  const at = approxTime.getTime();
  let best = ks[0]!;
  let bestScore = Infinity;
  for (const k of ks) {
    const timeCost = Math.abs(k.t - at) / step / 60; // 0..1 within the window
    const priceCost = lastClose && lastClose > 0 ? Math.abs(k.c - lastClose) / lastClose / 0.003 : 0; // 0.3% ≈ 1
    const score = priceCost + timeCost;
    if (score < bestScore) {
      bestScore = score;
      best = k;
    }
  }
  if (!lastClose) return { candle: best, note: 'Khớp theo thời gian trên trục chart (không đọc được giá) — kiểm tra lại' };
  const matched = Math.abs(best.c - lastClose) / lastClose < 0.005;
  return { candle: best, note: matched ? 'Khớp theo giá đóng cửa cây nến cuối trên chart' : 'Khớp gần đúng theo thời gian trên trục chart (giá không khớp hẳn — kiểm tra lại)' };
}

// ── Features ──────────────────────────────────────────────────────────────

const ema = (xs: number[], n: number) => {
  const k = 2 / (n + 1);
  let e = xs[0]!;
  const out = [e];
  for (let i = 1; i < xs.length; i++) out.push((e = xs[i]! * k + e * (1 - k)));
  return out;
};

function rsi(xs: number[], n = 14): number {
  let g = 0;
  let l = 0;
  for (let i = 1; i <= n; i++) {
    const d = xs[i]! - xs[i - 1]!;
    if (d > 0) g += d;
    else l -= d;
  }
  g /= n;
  l /= n;
  for (let i = n + 1; i < xs.length; i++) {
    const d = xs[i]! - xs[i - 1]!;
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
  }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}

export type ChartFeatures = {
  close: number;
  atrPct: number;
  ret5: number;
  ret20: number;
  ret50: number;
  rsi14: number;
  distEma20: number;
  distEma50: number;
  distEma200: number;
  ema20Slope: number;
  bbPos: number;
  bbWidth: number;
  rangePos50: number;
  volRatio: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Market state at the chart's last candle (all % values; computed on that timeframe). */
export async function computeFeatures(symbol: string, interval: string, chartTime: Date): Promise<ChartFeatures> {
  const ks = await fetchKlines(symbol, interval, { endTime: chartTime.getTime(), limit: 400 });
  if (ks.length < 60) throw new Error(`Chỉ có ${ks.length} nến trước thời điểm chart — quá ít để tính chỉ báo`);
  const c = ks.map((k) => k.c);
  const i = c.length - 1;
  const at = (arr: number[], j: number) => arr[j]!;
  const close = at(c, i);
  const pct = (a: number, b: number) => ((a - b) / b) * 100;
  const tr = ks.map((k, j) => (j === 0 ? k.h - k.l : Math.max(k.h - k.l, Math.abs(k.h - ks[j - 1]!.c), Math.abs(k.l - ks[j - 1]!.c))));
  const atr = tr.slice(-14).reduce((s, x) => s + x, 0) / 14;
  const e20 = ema(c, 20);
  const e50 = ema(c, 50);
  const e200 = ema(c, Math.min(200, c.length - 1));
  const last20 = c.slice(-20);
  const mean = last20.reduce((s, x) => s + x, 0) / 20;
  const sd = Math.sqrt(last20.reduce((s, x) => s + (x - mean) ** 2, 0) / 20);
  const hi50 = Math.max(...ks.slice(-50).map((k) => k.h));
  const lo50 = Math.min(...ks.slice(-50).map((k) => k.l));
  const vAvg = ks.slice(-21, -1).reduce((s, k) => s + k.v, 0) / 20;
  return {
    close,
    atrPct: r2((atr / close) * 100),
    ret5: r2(pct(close, at(c, i - 5))),
    ret20: r2(pct(close, at(c, i - 20))),
    ret50: r2(pct(close, at(c, i - 50))),
    rsi14: r2(rsi(c.slice(-150))),
    distEma20: r2(pct(close, at(e20, i))),
    distEma50: r2(pct(close, at(e50, i))),
    distEma200: r2(pct(close, at(e200, i))),
    ema20Slope: r2(pct(at(e20, i), at(e20, i - 5))),
    bbPos: r2(sd > 0 ? (close - (mean - 2 * sd)) / (4 * sd) : 0.5),
    bbWidth: r2(mean > 0 ? ((4 * sd) / mean) * 100 : 0),
    rangePos50: r2(hi50 > lo50 ? (close - lo50) / (hi50 - lo50) : 0.5),
    volRatio: r2(vAvg > 0 ? ks[i]!.v / vAvg : 1),
  };
}

/** Dimensionless vector: moves in ATR units so a 1h alt chart and a 1d BTC chart compare fairly. */
function vector(f: ChartFeatures): number[] {
  const a = Math.max(f.atrPct, 0.05);
  return [
    f.ret5 / a / 3,
    f.ret20 / a / 6,
    f.ret50 / a / 10,
    (f.rsi14 - 50) / 15,
    f.distEma20 / a / 3,
    f.distEma50 / a / 5,
    f.distEma200 / a / 10,
    f.ema20Slope / a / 1.5,
    (f.bbPos - 0.5) / 0.5,
    (f.rangePos50 - 0.5) / 0.5,
    Math.log(Math.max(f.volRatio, 0.05)) / 0.7,
  ].map((x) => Math.max(-4, Math.min(4, x)));
}

export type SimilarityInput = { id: string; features: ChartFeatures | null; tags: string[]; interval: string | null };

/** Smaller = more alike. Market state first; shared tags and the same timeframe pull a chart closer. */
export function distance(a: SimilarityInput, b: SimilarityInput): number | null {
  if (!a.features || !b.features) return null;
  const va = vector(a.features);
  const vb = vector(b.features);
  const d = Math.sqrt(va.reduce((s, x, i) => s + (x - vb[i]!) ** 2, 0) / va.length);
  const ta = new Set(a.tags);
  const shared = b.tags.filter((t) => ta.has(t)).length;
  const union = new Set([...a.tags, ...b.tags]).size;
  const jaccard = union ? shared / union : 0;
  return Math.max(0, d - 0.35 * jaccard + (a.interval && b.interval && a.interval !== b.interval ? 0.1 : 0));
}

/** 0..100 for the UI. d≈0 → 100, d≈1 (one "typical unit" apart on every axis) → ~37. */
export const similarityPct = (d: number) => Math.round(100 * Math.exp(-d));

// ── Outcome ───────────────────────────────────────────────────────────────

export const HORIZONS = [6, 24, 72] as const;
const MAX_BARS = 200;

export type HorizonStat = { bars: number; retPct: number; maxUpPct: number; maxDownPct: number };
export type TpSlResult = { result: 'TP' | 'SL' | 'OPEN'; bars: number | null };
export type ChartOutcome = {
  entry: number;
  barsSeen: number;
  horizons: Record<string, HorizonStat | null>;
  tpPct: number;
  slPct: number;
  long: TpSlResult;
  short: TpSlResult;
  computedAt: string;
};

/** What price did after the chart's candle: raw moves at 6/24/72 candles + first touch of TP/SL both ways. */
export async function computeOutcome(
  symbol: string,
  interval: string,
  chartTime: Date,
  entry: number,
  tpPct: number,
  slPct: number,
): Promise<{ outcome: ChartOutcome; done: boolean }> {
  const step = INTERVAL_MS[interval] ?? 3_600_000;
  const after = await fetchKlines(symbol, interval, { startTime: chartTime.getTime() + step, limit: MAX_BARS });
  const pct = (x: number) => r2(((x - entry) / entry) * 100);
  const horizons: Record<string, HorizonStat | null> = {};
  for (const h of HORIZONS) {
    if (after.length < h) {
      horizons[h] = null;
      continue;
    }
    const win = after.slice(0, h);
    horizons[h] = {
      bars: h,
      retPct: pct(win[h - 1]!.c),
      maxUpPct: pct(Math.max(...win.map((k) => k.h))),
      maxDownPct: pct(Math.min(...win.map((k) => k.l))),
    };
  }
  const firstTouch = (side: 1 | -1): TpSlResult => {
    const tp = entry * (1 + (side * tpPct) / 100);
    const sl = entry * (1 - (side * slPct) / 100);
    for (let i = 0; i < after.length; i++) {
      const k = after[i]!;
      const hitTp = side === 1 ? k.h >= tp : k.l <= tp;
      const hitSl = side === 1 ? k.l <= sl : k.h >= sl;
      // Both inside one candle: we can't tell the order — count it as SL (conservative).
      if (hitSl) return { result: 'SL', bars: i + 1 };
      if (hitTp) return { result: 'TP', bars: i + 1 };
    }
    return { result: 'OPEN', bars: null };
  };
  const long = firstTouch(1);
  const short = firstTouch(-1);
  const lastH = HORIZONS[HORIZONS.length - 1]!;
  const done = after.length >= MAX_BARS || (after.length >= lastH && long.result !== 'OPEN' && short.result !== 'OPEN');
  return {
    outcome: { entry, barsSeen: after.length, horizons, tpPct, slPct, long, short, computedAt: new Date().toISOString() },
    done,
  };
}

/** The outcome seen from one side. LONG/SHORT only; NONE/unlabeled → null. */
export function sideView(o: ChartOutcome | null, direction: string | null | undefined) {
  if (!o || (direction !== 'LONG' && direction !== 'SHORT')) return null;
  const s = direction === 'LONG' ? 1 : -1;
  const h = (n: number) => {
    const x = o.horizons[n];
    if (!x) return null;
    return { retPct: r2(s * x.retPct), favPct: s === 1 ? x.maxUpPct : r2(-x.maxDownPct), advPct: s === 1 ? x.maxDownPct : r2(-x.maxUpPct) };
  };
  return { tpSl: direction === 'LONG' ? o.long : o.short, h6: h(6), h24: h(24), h72: h(72) };
}
