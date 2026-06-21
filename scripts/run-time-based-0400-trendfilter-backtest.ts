/**
 * Time-based LONG @ 00:00 UTC, +2% TP, force-close 04:00 UTC, no stop — WITH a 1D trend filter.
 * Only take the day's trade if the most-recently-CLOSED 1D candle (the prior day) is in an UPTREND.
 *
 * Two filters compared against the unfiltered baseline:
 *   - UTBot-1D bull : daily close > UTBot trailing stop (kv=2, ATR10) — same as the live SOL/BNB cfg.
 *   - EMA200-1D bull: daily close > EMA200.
 *
 * Fixed $notional/trade (no compounding), fee feePct%/side. Symbols: SOL, BNB.
 *
 * Usage: ts-node --project apps/api/tsconfig.json scripts/run-time-based-0400-trendfilter-backtest.ts \
 *   [days] [feePctPerSide] [notional] [tpPct]
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const SYMBOLS = ['SOLUSDT', 'BNBUSDT'];
const ENTRY_HOUR = 0, EXIT_HOUR = 4;
const KV = 2, ATR_P = 10, EMA_P = 200;
const DAY_MS = 864e5;

type H1 = { open: number; high: number; low: number; close: number; openTime: number; hour: number };
type D1 = { open: number; high: number; low: number; close: number; openTime: number };

function fetchJson(url: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}
async function fetchKlines(symbol: string, interval: string, startMs: number, endMs: number) {
  const out: unknown[][] = []; let cur = startMs;
  while (cur < endMs) {
    const url = `${BINANCE_HOST}?symbol=${symbol}&interval=${interval}&startTime=${cur}&endTime=${endMs}&limit=${MAX_PER_REQ}`;
    const batch = (await fetchJson(url)) as unknown[][];
    if (!Array.isArray(batch) || batch.length === 0) break;
    out.push(...batch);
    if (batch.length < MAX_PER_REQ) break;
    cur = (batch[batch.length - 1]![0] as number) + 1;
  }
  return out;
}

const fmt = (n: number, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const usd = (n: number) => (n >= 0 ? '+$' : '-$') + fmt(Math.abs(n));

function wilderAtr(c: D1[], p: number): number[] {
  const n = c.length;
  const tr = c.map((x, i) => (i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1]!.close), Math.abs(x.low - c[i - 1]!.close))));
  const atr = new Array(n).fill(0); let s = 0;
  for (let i = 0; i < p; i++) s += tr[i]!;
  atr[p - 1] = s / p;
  for (let i = p; i < n; i++) atr[i] = (atr[i - 1]! * (p - 1) + tr[i]!) / p;
  return atr;
}
function utBotStops(c: D1[], p: number, kv: number): number[] {
  const atr = wilderAtr(c, p); const stop = new Array(c.length).fill(0);
  for (let i = 1; i < c.length; i++) {
    const nLoss = kv * atr[i]!, close = c[i]!.close, prevC = c[i - 1]!.close, prev = stop[i - 1]!;
    if (close > prev && prevC > prev) stop[i] = Math.max(prev, close - nLoss);
    else if (close < prev && prevC < prev) stop[i] = Math.min(prev, close + nLoss);
    else if (close > prev) stop[i] = close - nLoss;
    else stop[i] = close + nLoss;
  }
  return stop;
}
function ema(c: D1[], p: number): number[] {
  const out = new Array(c.length).fill(0); const k = 2 / (p + 1);
  let sma = 0; for (let i = 0; i < p; i++) sma += c[i]!.close; out[p - 1] = sma / p;
  for (let i = p; i < c.length; i++) out[i] = c[i]!.close * k + out[i - 1]! * (1 - k);
  return out;
}

type Filter = 'none' | 'utbot' | 'ema200';
type Res = { trades: number; tpHits: number; net: number; gross: number };

// build map: dayStart(ms) → bull? for each filter, keyed by the daily candle's openTime
function buildTrend(d1: D1[]): { utbot: Map<number, boolean>; ema: Map<number, boolean> } {
  const stop = utBotStops(d1, ATR_P, KV); const e = ema(d1, EMA_P);
  const utbot = new Map<number, boolean>(), emaM = new Map<number, boolean>();
  for (let i = 0; i < d1.length; i++) {
    if (stop[i]! > 0) utbot.set(d1[i]!.openTime, d1[i]!.close > stop[i]!);
    if (e[i]! > 0) emaM.set(d1[i]!.openTime, d1[i]!.close > e[i]!);
  }
  return { utbot, ema: emaM };
}

function run(h1: H1[], d1: D1[], notional: number, feePct: number, tpPct: number, filter: Filter, winStartMs: number): Res {
  const f = feePct / 100, tp = tpPct / 100;
  const { utbot, ema: emaM } = buildTrend(d1);
  const r: Res = { trades: 0, tpHits: 0, net: 0, gross: 0 };
  for (let i = 0; i < h1.length; i++) {
    const cand = h1[i]!;
    if (cand.hour !== ENTRY_HOUR || cand.openTime < winStartMs) continue;
    if (filter !== 'none') {
      // the daily candle that just CLOSED at this 00:00 == previous day's candle (openTime - 1 day)
      const prevDay = cand.openTime - DAY_MS;
      const bull = filter === 'utbot' ? utbot.get(prevDay) : emaM.get(prevDay);
      if (bull !== true) continue; // skip if not confirmed bull (also skips missing data)
    }
    const entry = cand.open, tpPx = entry * (1 + tp);
    let exitRet: number | null = null, hitTP = false;
    for (let j = i; j < h1.length; j++) {
      if (j > i && h1[j]!.hour === EXIT_HOUR) { exitRet = (h1[j]!.open - entry) / entry; break; }
      if (h1[j]!.high >= tpPx) { exitRet = tp; hitTP = true; break; }
      if (j - i > 8) { exitRet = (h1[j]!.close - entry) / entry; break; }
    }
    if (exitRet === null) continue;
    r.trades++; if (hitTP) r.tpHits++;
    r.gross += notional * exitRet;
    r.net += notional * ((1 + exitRet) * (1 - f) * (1 - f) - 1);
  }
  return r;
}

async function main() {
  const [, , daysA, feeA, notA, tpA] = process.argv;
  const days = Number(daysA ?? 365), fee = Number(feeA ?? 0.05), notional = Number(notA ?? 100), tpPct = Number(tpA ?? 2);
  const endMs = Date.now(), winStartMs = endMs - days * DAY_MS;
  const warmStartMs = winStartMs - 320 * DAY_MS; // warmup for EMA200/UTBot on the daily series

  console.log(`\n=== LONG @ 00:00 UTC · TP +${tpPct}% · force-close 04:00 UTC · 1D TREND FILTER · ${days}d · $${notional}/trade · fee ${fee}%/side ===`);
  console.log('(only enter when the prior-day 1D candle is bull)\n');

  const tot: Record<Filter, Res> = { none: { trades: 0, tpHits: 0, net: 0, gross: 0 }, utbot: { trades: 0, tpHits: 0, net: 0, gross: 0 }, ema200: { trades: 0, tpHits: 0, net: 0, gross: 0 } };
  for (const sym of SYMBOLS) {
    const raw1h = await fetchKlines(sym, '1h', winStartMs, endMs);
    const raw1d = await fetchKlines(sym, '1d', warmStartMs, endMs);
    const h1: H1[] = raw1h.map((k) => ({ open: +(k[1] as string), high: +(k[2] as string), low: +(k[3] as string), close: +(k[4] as string), openTime: k[0] as number, hour: new Date(k[0] as number).getUTCHours() }));
    const d1: D1[] = raw1d.map((k) => ({ open: +(k[1] as string), high: +(k[2] as string), low: +(k[3] as string), close: +(k[4] as string), openTime: k[0] as number }));

    console.log(`${sym}`);
    console.log('  filter        | trades | TP hit | TP% |  GROSS $  |   NET $   | net/trade');
    for (const filt of ['none', 'utbot', 'ema200'] as Filter[]) {
      const r = run(h1, d1, notional, fee, tpPct, filt, winStartMs);
      const tpRate = r.trades ? (r.tpHits / r.trades) * 100 : 0;
      console.log(
        `  ${filt.padEnd(13)} | ${String(r.trades).padStart(6)} | ${String(r.tpHits).padStart(6)} | ${(fmt(tpRate, 0) + '%').padStart(4)} | ` +
          `${usd(r.gross).padStart(9)} | ${usd(r.net).padStart(9)} | ${usd(r.trades ? r.net / r.trades : 0).padStart(8)}`,
      );
      tot[filt].trades += r.trades; tot[filt].tpHits += r.tpHits; tot[filt].gross += r.gross; tot[filt].net += r.net;
    }
    console.log('');
  }
  console.log('=== TOTAL (SOL + BNB) ===');
  console.log('  filter        | trades | TP hit |  GROSS $  |   NET $   | net/trade');
  for (const filt of ['none', 'utbot', 'ema200'] as Filter[]) {
    const r = tot[filt];
    console.log(
      `  ${filt.padEnd(13)} | ${String(r.trades).padStart(6)} | ${String(r.tpHits).padStart(6)} | ` +
        `${usd(r.gross).padStart(9)} | ${usd(r.net).padStart(9)} | ${usd(r.trades ? r.net / r.trades : 0).padStart(8)}`,
    );
  }
  console.log('');
}
main().catch((e) => { console.error(e); process.exit(1); });
