/**
 * BTC · UT Bot "community" strategies — one harness, same data, same fees.
 *
 * Strategies (all signals on candle CLOSE, filled at the NEXT candle's open, like TradingView's
 * strategy tester default):
 *   S1 flip        QuantNomad "UT Bot Strategy": long on UT buy, short on UT sell, always in market.
 *   S2 ema200rsi   "UT Bot + EMA200 + RSI filter": UT buy only if close > EMA200 and 30 < RSI14 < 70
 *                  (short mirror). Exit on the opposite UT signal.
 *   S3 ema200rsiRR same entries as S2 but a bracket: SL 2×ATR14, TP 2R (pickmytrade "1:2 RR").
 *   S4 stcHull     "UT Bot + STC + Hull" (viral YouTube / myncrypto myth-busting): UT buy + STC(12,26,50)
 *                  < 25 and rising + Hull(55) green. SL = UT trailing stop at entry, TP 1.5R.
 *   S5 heikin      UT Bot computed on Heikin Ashi close (QuantNomad "Signals from Heikin Ashi"), flip.
 *   S6 zlsmaHA     "ZLSMA + UT Bot + Heikin Ashi" scalp: UT(HA) buy + HA close > ZLSMA(50); exit on
 *                  opposite UT(HA) signal.
 *   S7 mtfAdx      "validate lower-TF buys with H1 trend + ADX>25": UT buy on this TF, H1 UT uptrend,
 *                  ADX14 > 25. Exit on opposite signal. (15m / 5m only)
 * Sizing: full account, 1x, compounded. Fee feePct%/side. When SL and TP are both inside one
 * candle the SL is assumed first (conservative).
 *
 * Usage: ts-node --project apps/api/tsconfig.json scripts/run-btc-utbot-community-strategies-backtest.ts \
 *   [startISO=2024-01-01] [feePctPerSide=0.05]
 */
import * as https from 'https';

type C = { t: number; o: number; h: number; l: number; c: number };
const M5 = 5 * 6e4;

function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => { let d = ''; res.on('data', (x) => (d += x)); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}
async function fetch5m(startMs: number, endMs: number): Promise<C[]> {
  const out: C[] = []; let cur = startMs;
  while (cur < endMs) {
    const batch = (await fetchJson(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&startTime=${cur}&endTime=${endMs}&limit=1000`)) as unknown[][];
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const k of batch) out.push({ t: k[0] as number, o: +(k[1] as string), h: +(k[2] as string), l: +(k[3] as string), c: +(k[4] as string) });
    if (batch.length < 1000) break;
    cur = (batch[batch.length - 1]![0] as number) + 1;
  }
  return out.filter((x) => x.t + M5 <= Date.now());
}
function aggregate(c5: C[], minutes: number): C[] {
  const ms = minutes * 6e4, out: C[] = [];
  for (const x of c5) {
    const t = Math.floor(x.t / ms) * ms, last = out[out.length - 1];
    if (last && last.t === t) { last.h = Math.max(last.h, x.h); last.l = Math.min(last.l, x.l); last.c = x.c; }
    else out.push({ t, o: x.o, h: x.h, l: x.l, c: x.c });
  }
  // drop a trailing incomplete bucket
  const lastT = c5[c5.length - 1]!.t;
  if (out.length && out[out.length - 1]!.t + ms > lastT + M5) out.pop();
  return out;
}

// ---------------- indicators ----------------
const ema = (a: number[], n: number) => { const k = 2 / (n + 1), o = new Array(a.length).fill(NaN); let p = NaN; for (let i = 0; i < a.length; i++) { p = Number.isNaN(p) ? a[i]! : a[i]! * k + p * (1 - k); o[i] = p; } return o; };
const wma = (a: number[], n: number) => { const o = new Array(a.length).fill(NaN), d = (n * (n + 1)) / 2; for (let i = n - 1; i < a.length; i++) { let s = 0; for (let j = 0; j < n; j++) s += a[i - j]! * (n - j); o[i] = s / d; } return o; };
const hma = (a: number[], n: number) => { const w1 = wma(a, Math.floor(n / 2)), w2 = wma(a, n); return wma(w1.map((v, i) => 2 * v - w2[i]!).map((v) => (Number.isNaN(v) ? 0 : v)), Math.round(Math.sqrt(n))); };
const linreg = (a: number[], n: number) => { const o = new Array(a.length).fill(NaN); for (let i = n - 1; i < a.length; i++) { let sx = 0, sy = 0, sxy = 0, sxx = 0; for (let j = 0; j < n; j++) { const x = j, y = a[i - n + 1 + j]!; sx += x; sy += y; sxy += x * y; sxx += x * x; } const m = (n * sxy - sx * sy) / (n * sxx - sx * sx), b = (sy - m * sx) / n; o[i] = b + m * (n - 1); } return o; };
const zlsma = (a: number[], n: number) => { const l1 = linreg(a, n), l2 = linreg(l1.map((v) => (Number.isNaN(v) ? a[0]! : v)), n); return l1.map((v, i) => v + (v - l2[i]!)); };
function rma(a: number[], n: number) { const o = new Array(a.length).fill(NaN); let s = 0; for (let i = 0; i < a.length; i++) { if (i < n) { s += a[i]!; if (i === n - 1) o[i] = s / n; } else o[i] = (o[i - 1]! * (n - 1) + a[i]!) / n; } return o; }
const trueRange = (c: C[]) => c.map((x, i) => (i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - c[i - 1]!.c), Math.abs(x.l - c[i - 1]!.c))));
const atr = (c: C[], n: number) => rma(trueRange(c), n);
function rsi(a: number[], n: number) { const g = a.map((v, i) => (i ? Math.max(0, v - a[i - 1]!) : 0)), l = a.map((v, i) => (i ? Math.max(0, a[i - 1]! - v) : 0)); const ag = rma(g, n), al = rma(l, n); return ag.map((v, i) => (al[i] === 0 ? 100 : 100 - 100 / (1 + v / al[i]!))); }
function adx(c: C[], n: number) {
  const pdm = c.map((x, i) => { if (!i) return 0; const up = x.h - c[i - 1]!.h, dn = c[i - 1]!.l - x.l; return up > dn && up > 0 ? up : 0; });
  const mdm = c.map((x, i) => { if (!i) return 0; const up = x.h - c[i - 1]!.h, dn = c[i - 1]!.l - x.l; return dn > up && dn > 0 ? dn : 0; });
  const tr = rma(trueRange(c), n), p = rma(pdm, n), m = rma(mdm, n);
  const dx = tr.map((t, i) => { const pd = (100 * p[i]!) / t, md = (100 * m[i]!) / t; return pd + md === 0 ? 0 : (100 * Math.abs(pd - md)) / (pd + md); });
  return rma(dx.map((v) => (Number.isNaN(v) ? 0 : v)), n);
}
/** STC by shayankm ("STC Indicator - A Better MACD"), Length 12, Fast 26, Slow 50, factor 0.5. */
function stc(close: number[], len = 12, fast = 26, slow = 50, f = 0.5) {
  const e1 = ema(close, fast), e2 = ema(close, slow), macd = e1.map((v, i) => v - e2[i]!);
  const n = close.length, out = new Array(n).fill(NaN);
  let c5 = 0, ddd = NaN, d6 = 0, e5 = NaN; const dddArr: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = Math.max(0, i - len + 1);
    let lo = Infinity, hi = -Infinity; for (let j = s; j <= i; j++) { lo = Math.min(lo, macd[j]!); hi = Math.max(hi, macd[j]!); }
    c5 = hi - lo > 0 ? ((macd[i]! - lo) / (hi - lo)) * 100 : c5;
    ddd = Number.isNaN(ddd) ? c5 : ddd + f * (c5 - ddd); dddArr.push(ddd);
    let lo2 = Infinity, hi2 = -Infinity; for (let j = s; j <= i; j++) { lo2 = Math.min(lo2, dddArr[j]!); hi2 = Math.max(hi2, dddArr[j]!); }
    d6 = hi2 - lo2 > 0 ? ((ddd - lo2) / (hi2 - lo2)) * 100 : d6;
    e5 = Number.isNaN(e5) ? d6 : e5 + f * (d6 - e5);
    out[i] = e5;
  }
  return out;
}
/** UT Bot trailing stop on `src` (close or Heikin-Ashi close), ATR from real candles. */
function utBot(c: C[], src: number[], kv: number, period = 10) {
  const a = atr(c, period), stop = new Array(c.length).fill(0);
  for (let i = 0; i < c.length; i++) {
    const nLoss = (a[i] ?? NaN) * kv; if (!Number.isFinite(nLoss)) continue;
    const s = src[i]!, ps = i ? stop[i - 1]! : 0, pc = i ? src[i - 1]! : 0;
    if (s > ps && pc > ps) stop[i] = Math.max(ps, s - nLoss);
    else if (s < ps && pc < ps) stop[i] = Math.min(ps, s + nLoss);
    else if (s > ps) stop[i] = s - nLoss;
    else stop[i] = s + nLoss;
  }
  const up = src.map((s, i) => stop[i]! > 0 && s > stop[i]!);
  const buy = src.map((s, i) => i > 0 && stop[i]! > 0 && stop[i - 1]! > 0 && src[i - 1]! <= stop[i - 1]! && s > stop[i]!);
  const sell = src.map((s, i) => i > 0 && stop[i]! > 0 && stop[i - 1]! > 0 && src[i - 1]! >= stop[i - 1]! && s < stop[i]!);
  return { stop, up, buy, sell };
}
function heikinClose(c: C[]) { const hc = c.map((x) => (x.o + x.h + x.l + x.c) / 4); return hc; }

// ---------------- engine ----------------
type Sig = { long: boolean[]; short: boolean[]; exitLong?: boolean[]; exitShort?: boolean[]; sl?: number[]; slDistL?: number[]; rr?: number };
type Res = { n: number; win: number; gw: number; gl: number; eqG: number; eqN: number; dd: number; years: Record<number, number> };

function backtest(c: C[], startMs: number, s: Sig, fee: number): Res {
  const f = fee / 100;
  const r: Res = { n: 0, win: 0, gw: 0, gl: 0, eqG: 1, eqN: 1, dd: 0, years: {} };
  let peak = 1;
  let pos: { side: 1 | -1; entry: number; sl?: number; tp?: number; y: number } | null = null;
  const close = (px: number) => {
    const ret = pos!.side * (px - pos!.entry) / pos!.entry;
    const netMul = (1 + ret) * (1 - f) * (1 - f);
    r.n++; if (netMul > 1) { r.win++; r.gw += netMul - 1; } else r.gl += 1 - netMul;
    r.eqG *= 1 + ret; r.eqN *= netMul; peak = Math.max(peak, r.eqN); r.dd = Math.max(r.dd, (peak - r.eqN) / peak);
    r.years[pos!.y] = (r.years[pos!.y] ?? 1) * netMul;
    pos = null;
  };
  const bracket = s.slDistL !== undefined;
  for (let i = 1; i < c.length; i++) {
    const b = c[i]!, p = i - 1; // decisions from bar p close, executed at bar i open
    if (c[p]!.t < startMs) continue;
    // 1) signal-based exits / entries at this bar's open
    if (!bracket) {
      if (pos && pos.side === 1 && (s.exitLong ?? s.short)[p]) close(b.o);
      if (pos && pos.side === -1 && (s.exitShort ?? s.long)[p]) close(b.o);
      if (!pos && s.long[p]) pos = { side: 1, entry: b.o, y: new Date(b.t).getUTCFullYear() };
      else if (!pos && s.short[p]) pos = { side: -1, entry: b.o, y: new Date(b.t).getUTCFullYear() };
    } else if (!pos && (s.long[p] || s.short[p])) {
      const side: 1 | -1 = s.long[p] ? 1 : -1, d = s.slDistL![p]!;
      if (Number.isFinite(d) && d > 0) pos = { side, entry: b.o, sl: b.o - side * d, tp: b.o + side * d * s.rr!, y: new Date(b.t).getUTCFullYear() };
    }
    // 2) intrabar SL / TP for bracket trades (SL first if both)
    if (pos && pos.sl !== undefined) {
      if (pos.side === 1) { if (b.l <= pos.sl) close(Math.min(b.o, pos.sl)); else if (b.h >= pos.tp!) close(pos.tp!); }
      else { if (b.h >= pos.sl) close(Math.max(b.o, pos.sl)); else if (b.l <= pos.tp!) close(pos.tp!); }
    }
  }
  if (pos) close(c[c.length - 1]!.c);
  return r;
}

// ---------------- strategies ----------------
function build(name: string, c: C[], kv: number, h1?: { c: C[]; up: boolean[] }): Sig | null {
  const close = c.map((x) => x.c);
  const ut = utBot(c, close, kv);
  const n = c.length;
  if (name === 'S1 flip') return { long: ut.buy, short: ut.sell };
  if (name === 'S2 ema200+rsi' || name === 'S3 ema200+rsi 2R') {
    const e = ema(close, 200), r = rsi(close, 14), a = atr(c, 14);
    const long = ut.buy.map((v, i) => v && close[i]! > e[i]! && r[i]! > 30 && r[i]! < 70);
    const short = ut.sell.map((v, i) => v && close[i]! < e[i]! && r[i]! > 30 && r[i]! < 70);
    if (name === 'S2 ema200+rsi') return { long, short, exitLong: ut.sell, exitShort: ut.buy };
    return { long, short, slDistL: a.map((v) => 2 * v), rr: 2 };
  }
  if (name === 'S4 stc+hull 1.5R') {
    const st = stc(close), hl = hma(close, 55);
    const long = ut.buy.map((v, i) => v && i > 2 && st[i]! < 25 && st[i]! > st[i - 1]! && hl[i]! > hl[i - 2]!);
    const short = ut.sell.map((v, i) => v && i > 2 && st[i]! > 75 && st[i]! < st[i - 1]! && hl[i]! < hl[i - 2]!);
    return { long, short, slDistL: close.map((x, i) => Math.abs(x - ut.stop[i]!)), rr: 1.5 };
  }
  if (name === 'S5 heikin flip') { const u = utBot(c, heikinClose(c), kv); return { long: u.buy, short: u.sell }; }
  if (name === 'S6 zlsma+HA') {
    const hc = heikinClose(c), u = utBot(c, hc, kv), z = zlsma(close, 50);
    return { long: u.buy.map((v, i) => v && hc[i]! > z[i]!), short: u.sell.map((v, i) => v && hc[i]! < z[i]!), exitLong: u.sell, exitShort: u.buy };
  }
  if (name === 'S7 H1 trend+ADX') {
    if (!h1) return null;
    const ad = adx(c, 14);
    // H1 trend known at this bar's close = last H1 candle closed by then
    let k = -1; const htfUp: (boolean | null)[] = new Array(n).fill(null);
    for (let i = 0; i < n; i++) { const endT = c[i]!.t + (c[1]!.t - c[0]!.t); while (k + 1 < h1.c.length && h1.c[k + 1]!.t + 36e5 <= endT) k++; htfUp[i] = k >= 0 ? h1.up[k]! : null; }
    return { long: ut.buy.map((v, i) => v && htfUp[i] === true && ad[i]! > 25), short: ut.sell.map((v, i) => v && htfUp[i] === false && ad[i]! > 25), exitLong: ut.sell, exitShort: ut.buy };
  }
  return null;
}

const pct = (m: number) => `${m >= 1 ? '+' : ''}${((m - 1) * 100).toFixed(1)}%`;

async function main() {
  const [, , startA, feeA] = process.argv;
  const startMs = Date.parse(startA ?? '2024-01-01T00:00:00Z'), fee = Number(feeA ?? 0.05);
  const c5 = await fetch5m(startMs - 90 * 864e5, Date.now());
  const tfs: Record<string, C[]> = { '5m': c5, '15m': aggregate(c5, 15), '1h': aggregate(c5, 60), '4h': aggregate(c5, 240) };
  const bh = (() => { const a = tfs['1h']!.find((x) => x.t >= startMs)!, z = tfs['1h']![tfs['1h']!.length - 1]!; return z.c / a.o; })();

  console.log(`\n=== BTCUSDT · UT Bot community strategies · ${new Date(startMs).toISOString().slice(0, 10)} → ${new Date(c5[c5.length - 1]!.t).toISOString().slice(0, 16)} UTC · fee ${fee}%/side · full account 1x compounded ===`);
  console.log(`    Buy & hold BTC over the same window: ${pct(bh)}\n`);
  console.log('  strategy             | TF  | kv | trades | win% |  PF  |  GROSS   |   NET    | maxDD | net by year');

  const plan: [string, string[]][] = [
    ['S1 flip', ['15m', '1h', '4h']],
    ['S2 ema200+rsi', ['15m', '1h', '4h']],
    ['S3 ema200+rsi 2R', ['15m', '1h', '4h']],
    ['S4 stc+hull 1.5R', ['5m', '15m', '1h']],
    ['S5 heikin flip', ['15m', '1h', '4h']],
    ['S6 zlsma+HA', ['5m', '15m', '1h']],
    ['S7 H1 trend+ADX', ['5m', '15m']],
  ];
  const h1s: Record<number, boolean[]> = {};
  for (const kv of [1, 2, 3]) h1s[kv] = utBot(tfs['1h']!, tfs['1h']!.map((x) => x.c), kv).up;

  for (const [name, list] of plan) {
    for (const tf of list) for (const kv of [1, 2, 3]) {
      const c = tfs[tf]!;
      const sig = build(name, c, kv, { c: tfs['1h']!, up: h1s[kv]! });
      if (!sig) continue;
      const r = backtest(c, startMs, sig, fee);
      const pf = r.gl > 0 ? r.gw / r.gl : Infinity;
      const yrs = Object.entries(r.years).map(([y, m]) => `${y.slice(2)}:${pct(m)}`).join(' ');
      console.log(`  ${name.padEnd(21)}| ${tf.padEnd(3)} | ${kv}  | ${String(r.n).padStart(6)} | ${((r.win / (r.n || 1)) * 100).toFixed(0).padStart(3)}% | ${(Number.isFinite(pf) ? pf.toFixed(2) : '∞').padStart(4)} | ${pct(r.eqG).padStart(8)} | ${pct(r.eqN).padStart(8)} | ${(r.dd * 100).toFixed(0).padStart(4)}% | ${yrs}`);
    }
    console.log('');
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
