/**
 * RSI MODEL COMPARISON backtest — find the most profitable RSI "price model"
 * over a long window (default 2 years = 730d), compounded $1000.
 *
 * The question: "which RSI-based model makes the most money?" So instead of one
 * fixed rule we backtest several canonical RSI archetypes, each swept over its
 * key params (RSI period × oversold/overbought thresholds), and rank by net
 * compounded return after fees.
 *
 * Models (all decisions on candle CLOSE, executed at that close — no lookahead):
 *   M1  mr-long      LONG-ONLY mean reversion. Enter long when RSI crosses UP
 *                    through `os`; exit to flat when RSI >= `ob`.
 *   M2  touch-long   LONG-ONLY. Enter when RSI <= `os` (touch oversold); exit
 *                    when RSI >= `ob`. (more aggressive than M1)
 *   M3  midline-ls   ALWAYS-IN-MARKET momentum. Long while RSI >= 50, short while
 *                    RSI < 50; stop-and-reverse on the 50 cross. (thresholds n/a)
 *   M4  mr-ls        ALWAYS-IN counter-trend. Flip LONG when RSI crosses up
 *                    through `os`, flip SHORT when RSI crosses down through `ob`.
 *   M5  mom-long     LONG-ONLY trend. Enter long on RSI cross UP through 50,
 *                    exit on cross DOWN through 50. (thresholds n/a)
 *
 * Equity: compounded, full equity in/out, no leverage. Long return = px/entry−1;
 * short return = entry/px−1 (spot-style approx, no funding). Fee `feePct`%/side
 * charged on both legs. Max drawdown is mark-to-market each bar on the open trade.
 * Shorts are a frictionless approximation — real futures pay funding, so L/S model
 * returns are optimistic.
 *
 * Usage:
 *   ts-node --project apps/api/tsconfig.json scripts/run-rsi-models-backtest.ts \
 *     [symbol] [interval] [days] [capital] [feePctPerSide]
 *   # default: BTCUSDT 4h 730 1000 0.05
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const DAY_MS = 864e5;

type Candle = { open: number; high: number; low: number; close: number; t: number };

function fetchJson(url: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}
async function fetchKlines(symbol: string, interval: string, startMs: number, endMs: number): Promise<Candle[]> {
  const out: Candle[] = []; let cur = startMs;
  while (cur < endMs) {
    const url = `${BINANCE_HOST}?symbol=${symbol}&interval=${interval}&startTime=${cur}&endTime=${endMs}&limit=${MAX_PER_REQ}`;
    const batch = (await fetchJson(url)) as unknown[][];
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const k of batch) out.push({ t: k[0] as number, open: +(k[1] as string), high: +(k[2] as string), low: +(k[3] as string), close: +(k[4] as string) });
    if (batch.length < MAX_PER_REQ) break;
    cur = (batch[batch.length - 1]![0] as number) + 1;
  }
  return out;
}
const fmt = (n: number, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n: number) => (n >= 0 ? '+' : '') + fmt(n, 1) + '%';

function wilderRsi(c: Candle[], p: number): number[] {
  const n = c.length, rsi = new Array(n).fill(50);
  if (n <= p) return rsi;
  let ag = 0, al = 0;
  for (let i = 1; i <= p; i++) { const ch = c[i]!.close - c[i - 1]!.close; if (ch >= 0) ag += ch; else al -= ch; }
  ag /= p; al /= p;
  rsi[p] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = p + 1; i < n; i++) {
    const ch = c[i]!.close - c[i - 1]!.close;
    ag = (ag * (p - 1) + Math.max(ch, 0)) / p;
    al = (al * (p - 1) + Math.max(-ch, 0)) / p;
    rsi[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return rsi;
}

type Model = 'mr-long' | 'touch-long' | 'midline-ls' | 'mr-ls' | 'mom-long';
type Res = { trades: number; wins: number; finalEq: number; retPct: number; maxDDPct: number; exposurePct: number };

/** desired target position at close of bar i: 1 long, -1 short, 0 flat, null = keep current */
function target(model: Model, rsi: number[], i: number, pos: number, os: number, ob: number): number | null {
  const r = rsi[i]!, rp = rsi[i - 1]!;
  switch (model) {
    case 'mr-long':
      if (pos === 0 && rp < os && r >= os) return 1;
      if (pos === 1 && r >= ob) return 0;
      return null;
    case 'touch-long':
      if (pos === 0 && r <= os) return 1;
      if (pos === 1 && r >= ob) return 0;
      return null;
    case 'midline-ls':
      return r >= 50 ? 1 : -1;
    case 'mr-ls':
      if (rp < os && r >= os) return 1;
      if (rp > ob && r <= ob) return -1;
      return null;
    case 'mom-long':
      if (pos === 0 && rp < 50 && r >= 50) return 1;
      if (pos === 1 && rp >= 50 && r < 50) return 0;
      return null;
  }
}

function runModel(model: Model, c: Candle[], rsi: number[], os: number, ob: number, capital: number, feePct: number, warm: number): Res {
  const f = feePct / 100;
  // closing both legs costs (1-f)^2 of the gross multiplier
  const closeMult = (entry: number, px: number, dir: number) => (dir === 1 ? px / entry : 2 - px / entry) * (1 - f) * (1 - f);
  let E = capital, pos = 0, entry = 0;
  let peak = capital, maxDD = 0, trades = 0, wins = 0, barsIn = 0;
  const total = c.length - warm;
  for (let i = warm; i < c.length; i++) {
    // mark-to-market for drawdown on the open position
    const open = pos === 0 ? E : E * closeMult(entry, c[i]!.close, pos);
    if (open > peak) peak = open;
    const dd = (peak - open) / peak;
    if (dd > maxDD) maxDD = dd;
    if (pos !== 0) barsIn++;

    const want = target(model, rsi, i, pos, os, ob);
    if (want === null || want === pos) continue;
    const px = c[i]!.close;
    if (pos !== 0) { // realize exit
      const mult = closeMult(entry, px, pos);
      E *= mult; trades++; if (mult > 1) wins++;
    }
    pos = want;
    if (pos !== 0) entry = px;
  }
  // close any open position at the last close
  if (pos !== 0) { const mult = closeMult(entry, c[c.length - 1]!.close, pos); E *= mult; trades++; if (mult > 1) wins++; }
  return { trades, wins, finalEq: E, retPct: (E / capital - 1) * 100, maxDDPct: maxDD * 100, exposurePct: total > 0 ? (barsIn / total) * 100 : 0 };
}

async function main() {
  const symbol = (process.argv[2] ?? 'BTCUSDT').toUpperCase();
  const interval = process.argv[3] ?? '4h';
  const days = Number(process.argv[4] ?? 730);
  const capital = Number(process.argv[5] ?? 1000);
  const fee = Number(process.argv[6] ?? 0.05);

  const endMs = Date.now(), winStartMs = endMs - days * DAY_MS, warmStartMs = winStartMs - 10 * DAY_MS;
  console.log(`\nFetching ${symbol} ${interval} …`);
  const c = await fetchKlines(symbol, interval, warmStartMs, endMs);
  if (c.length < 60) { console.log('  not enough candles'); return; }
  // first index inside the scored window
  let warm = c.findIndex((x) => x.t >= winStartMs);
  if (warm < 30) warm = 30;
  console.log(`  ${c.length} candles (${new Date(c[0]!.t).toISOString().slice(0, 10)} → ${new Date(c[c.length - 1]!.t).toISOString().slice(0, 10)}), scoring from index ${warm}`);

  const bh = (c[c.length - 1]!.close / c[warm]!.close - 1) * 100; // buy & hold benchmark over scored window

  const periods = [7, 14, 21];
  const pairs: [number, number][] = [[20, 80], [25, 75], [30, 70], [35, 65], [40, 60]];
  const thresholdModels: Model[] = ['mr-long', 'touch-long', 'mr-ls'];
  const fixedModels: Model[] = ['midline-ls', 'mom-long'];

  console.log(`\n=== RSI MODEL SWEEP · ${symbol} ${interval} · ${days}d · $${capital} compounded · fee ${fee}%/side ===`);
  console.log(`    Buy & hold over window: ${pct(bh)}\n`);
  console.log('  model       | per | os/ob  | trades | win%  | expo% | maxDD% |   return   |  final $   ');
  console.log('  ------------+-----+--------+--------+-------+-------+--------+------------+------------');

  type Row = { model: Model; p: number; os: number; ob: number; r: Res };
  const rows: Row[] = [];
  for (const p of periods) {
    const rsi = wilderRsi(c, p);
    for (const m of thresholdModels) {
      for (const [os, ob] of pairs) rows.push({ model: m, p, os, ob, r: runModel(m, c, rsi, os, ob, capital, fee, warm) });
    }
    for (const m of fixedModels) rows.push({ model: m, p, os: 50, ob: 50, r: runModel(m, c, rsi, 50, 50, capital, fee, warm) });
  }
  // print grouped by model
  for (const m of [...thresholdModels, ...fixedModels]) {
    for (const row of rows.filter((x) => x.model === m)) {
      const { r } = row;
      const wr = r.trades ? (r.wins / r.trades) * 100 : 0;
      const osob = row.os === 50 ? '  --  ' : `${row.os}/${row.ob}`;
      console.log(
        `  ${m.padEnd(11)} | ${String(row.p).padStart(3)} | ${osob.padStart(6)} | ${String(r.trades).padStart(6)} | ${(fmt(wr, 0) + '%').padStart(5)} | ${(fmt(r.exposurePct, 0) + '%').padStart(5)} | ${(fmt(r.maxDDPct, 0) + '%').padStart(6)} | ${pct(r.retPct).padStart(10)} | ${('$' + fmt(r.finalEq, 0)).padStart(10)}`,
      );
    }
    console.log('  ------------+-----+--------+--------+-------+-------+--------+------------+------------');
  }

  const ranked = [...rows].filter((x) => x.r.trades >= 8).sort((a, b) => b.r.finalEq - a.r.finalEq);
  console.log('\n  TOP 5 by net return (≥8 trades):');
  for (const row of ranked.slice(0, 5)) {
    const { r } = row;
    const osob = row.os === 50 ? '--' : `${row.os}/${row.ob}`;
    console.log(`    ${row.model.padEnd(11)} per${row.p} ${osob.padStart(5)} → ${pct(r.retPct).padStart(9)} ($${fmt(r.finalEq, 0)}), ${r.trades} trades, win ${fmt(r.trades ? (r.wins / r.trades) * 100 : 0, 0)}%, maxDD ${fmt(r.maxDDPct, 0)}%`);
  }
  if (ranked[0]) {
    const b = ranked[0];
    console.log(`\n  WINNER: ${b.model} · period ${b.p} · ${b.os === 50 ? 'midline' : b.os + '/' + b.ob} → ${pct(b.r.retPct)} vs buy&hold ${pct(bh)}\n`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
