/**
 * Backtest the user's claim:
 *   "On Binance small/mid-cap coins, on the D1 chart, when the two StochRSI lines
 *    cross UP (%K crosses above %D) price very often pumps hard."
 *
 * We rebuild the small-cap-radar universe the same way the app does
 * (Binance USDT TRADING pairs whose CoinGecko market cap < $50M), then on D1:
 *   - compute StochRSI (%K / %D, TradingView defaults 14/14/3/3)
 *   - detect bullish crosses (%K crosses above %D on a CLOSED daily candle)
 *   - measure FORWARD returns after the cross (realized hold AND best-case max)
 *     over 7 / 14 / 30 days, and compare to the unconditional baseline (every day).
 *   - split crosses by the zone they fire in: oversold (<20), low (<30), lower-half (<50), any.
 *
 * No app auth needed — CoinGecko demo endpoint + public Binance klines.
 */

const MARKET_CAP_LIMIT = 50_000_000;
const MARKET_CAP_FLOOR = 3_000_000;     // skip dead/illiquid micro-caps
const GECKO_PAGES = 8;                   // top 2000 by mcap — deep enough to reach well below $50M
const KLINE_LIMIT = 1000;                // ~2.7y of daily candles
const FWD = [7, 14, 30];                 // forward windows (days)

// StochRSI params (TradingView defaults)
const RSI_LEN = 14, STOCH_LEN = 14, SMOOTH_K = 3, SMOOTH_D = 3;

type Zone = { label: string; max: number };
const ZONES: Zone[] = [
  { label: 'oversold cross (%K<20)', max: 20 },
  { label: 'low cross (%K<30)', max: 30 },
  { label: 'lower-half cross (%K<50)', max: 50 },
  { label: 'any bullish cross', max: 101 },
];

// ---------- indicator helpers ----------
function rsiSeries(closes: number[], period = 14): number[] {
  const out: number[] = new Array(closes.length).fill(NaN);
  if (closes.length <= period) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i++) { const d = closes[i]! - closes[i - 1]!; if (d >= 0) g += d; else l -= d; }
  g /= period; l /= period;
  out[period] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d >= 0) { g = (g * (period - 1) + d) / period; l = (l * (period - 1)) / period; }
    else { g = (g * (period - 1)) / period; l = (l * (period - 1) - d) / period; }
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

function sma(values: number[], n: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  for (let i = 0; i < values.length; i++) {
    if (i < n - 1) continue;
    let s = 0, ok = true;
    for (let j = i - n + 1; j <= i; j++) { const v = values[j]!; if (Number.isNaN(v)) { ok = false; break; } s += v; }
    if (ok) out[i] = s / n;
  }
  return out;
}

function stochRsi(closes: number[]): { k: number[]; d: number[] } {
  const rsi = rsiSeries(closes, RSI_LEN);
  const raw: number[] = new Array(closes.length).fill(NaN);
  for (let i = 0; i < closes.length; i++) {
    let lo = Infinity, hi = -Infinity, ok = true;
    for (let j = i - STOCH_LEN + 1; j <= i; j++) {
      if (j < 0) { ok = false; break; }
      const v = rsi[j]!;
      if (Number.isNaN(v)) { ok = false; break; }
      if (v < lo) lo = v; if (v > hi) hi = v;
    }
    if (ok) raw[i] = hi === lo ? 0 : ((rsi[i]! - lo) / (hi - lo)) * 100;
  }
  const k = sma(raw, SMOOTH_K);
  const d = sma(k, SMOOTH_D);
  return { k, d };
}

// ---------- stats ----------
function median(a: number[]): number { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]!; }
function mean(a: number[]): number { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function pctGe(a: number[], t: number): number { return a.length ? a.filter((v) => v >= t).length / a.length : 0; }

function realizedFwd(closes: number[], i: number, days: number): number | null {
  const j = i + days; if (j >= closes.length) return null;
  return (closes[j]! - closes[i]!) / closes[i]!;
}
function maxFwd(highs: number[], closes: number[], i: number, days: number): number | null {
  const end = i + days; if (end >= closes.length) return null;
  let best = -Infinity;
  for (let j = i + 1; j <= end; j++) { const r = (highs[j]! - closes[i]!) / closes[i]!; if (r > best) best = r; }
  return best === -Infinity ? null : best;
}

// ---------- data ----------
function geckoHeader(): Record<string, string> {
  const key = (process.env.COINGECKO_API_KEY || '').trim();
  if (!key) return {};
  return key.startsWith('CG-') ? { 'x-cg-pro-api-key': key } : { 'x-cg-demo-api-key': key };
}
function geckoBase(): string {
  const key = (process.env.COINGECKO_API_KEY || '').trim();
  return key.startsWith('CG-') ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3';
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function binanceUsdtBases(): Promise<Set<string>> {
  const r = await fetch('https://api.binance.com/api/v3/exchangeInfo');
  const j = (await r.json()) as any;
  const set = new Set<string>();
  for (const s of j.symbols ?? []) {
    if (s.status === 'TRADING' && s.quoteAsset === 'USDT') set.add(String(s.baseAsset).toUpperCase());
  }
  return set;
}

async function buildUniverse(): Promise<string[]> {
  const bases = await binanceUsdtBases();
  const hdr = geckoHeader(); const base = geckoBase();
  const kept = new Map<string, number>(); // symbol -> mcap
  for (let page = 1; page <= GECKO_PAGES; page++) {
    const url = `${base}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=false`;
    let coins: any[] = [];
    try { const r = await fetch(url, { headers: hdr }); coins = (await r.json()) as any[]; } catch { coins = []; }
    if (!Array.isArray(coins) || !coins.length) { await sleep(2500); continue; }
    for (const c of coins) {
      const cap = c.market_cap ?? 0;
      const sym = String(c.symbol || '').toUpperCase();
      if (cap >= MARKET_CAP_FLOOR && cap < MARKET_CAP_LIMIT && bases.has(sym) && !kept.has(sym)) kept.set(sym, cap);
    }
    await sleep(2500);
  }
  return [...kept.keys()];
}

async function fetchDaily(symbol: string): Promise<{ h: number[]; c: number[] } | null> {
  try {
    const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1d&limit=${KLINE_LIMIT}`);
    if (!r.ok) return null;
    const k = (await r.json()) as any[];
    if (!Array.isArray(k) || k.length < 120) return null;
    return { h: k.map((x) => parseFloat(x[2])), c: k.map((x) => parseFloat(x[4])) };
  } catch { return null; }
}

async function main() {
  console.log('Building small-cap-radar universe (Binance USDT, CoinGecko mcap $3M–$50M)...');
  const universe = await buildUniverse();
  console.log(`Universe: ${universe.length} coins.\n`);

  const coins: { sym: string; h: number[]; c: number[] }[] = [];
  for (const sym of universe) { const d = await fetchDaily(sym); if (d) coins.push({ sym, ...d }); }
  console.log(`Fetched D1 for ${coins.length}/${universe.length} coins (>=120 candles).\n`);

  // baseline: forward returns over ALL closed days
  console.log('=== BASELINE (every day, all coins) ===');
  const baseReal: Record<number, number[]> = {}, baseMax: Record<number, number[]> = {};
  for (const w of FWD) { baseReal[w] = []; baseMax[w] = []; }
  for (const c of coins) for (let i = 30; i < c.c.length - 1; i++) for (const w of FWD) {
    const rf = realizedFwd(c.c, i, w); const mf = maxFwd(c.h, c.c, i, w);
    if (rf !== null) baseReal[w]!.push(rf); if (mf !== null) baseMax[w]!.push(mf);
  }
  for (const w of FWD) {
    console.log(`  ${w}d  realized: median ${(median(baseReal[w]!) * 100).toFixed(1)}% mean ${(mean(baseReal[w]!) * 100).toFixed(1)}%  |  maxFwd: median ${(median(baseMax[w]!) * 100).toFixed(1)}% mean ${(mean(baseMax[w]!) * 100).toFixed(1)}% %>=+20% ${(pctGe(baseMax[w]!, 0.2) * 100).toFixed(0)} %>=+50% ${(pctGe(baseMax[w]!, 0.5) * 100).toFixed(0)}  (n=${baseReal[w]!.length})`);
  }
  console.log('');

  // signal: bullish StochRSI cross, by zone
  for (const z of ZONES) {
    let n = 0;
    const real: Record<number, number[]> = {}, mx: Record<number, number[]> = {};
    for (const w of FWD) { real[w] = []; mx[w] = []; }
    for (const c of coins) {
      const { k, d } = stochRsi(c.c);
      for (let i = 31; i < c.c.length - 1; i++) {
        if (Number.isNaN(k[i]!) || Number.isNaN(d[i]!) || Number.isNaN(k[i - 1]!) || Number.isNaN(d[i - 1]!)) continue;
        const crossedUp = k[i - 1]! <= d[i - 1]! && k[i]! > d[i]!;
        if (!crossedUp || k[i]! >= z.max) continue;
        n++;
        for (const w of FWD) { const rf = realizedFwd(c.c, i, w); const mf = maxFwd(c.h, c.c, i, w); if (rf !== null) real[w]!.push(rf); if (mf !== null) mx[w]!.push(mf); }
      }
    }
    console.log(`=== ${z.label} — ${n} events ===`);
    for (const w of FWD) {
      console.log(`  ${w}d  realized: median ${(median(real[w]!) * 100).toFixed(1)}% mean ${(mean(real[w]!) * 100).toFixed(1)}%  |  maxFwd: median ${(median(mx[w]!) * 100).toFixed(1)}% mean ${(mean(mx[w]!) * 100).toFixed(1)}% %>=+20% ${(pctGe(mx[w]!, 0.2) * 100).toFixed(0)} %>=+50% ${(pctGe(mx[w]!, 0.5) * 100).toFixed(0)}`);
    }
    console.log('');
  }
}

main();
