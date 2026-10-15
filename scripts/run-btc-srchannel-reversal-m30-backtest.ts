/**
 * BTC M30 · S/R Channel bounce/rejection (LonesomeTheBlue "Support Resistance Channels").
 *
 * Indicator (TradingView inputs): Pivot Period 10, Source High/Low, Channel Width 5%,
 * Min Strength 1, Max S/R 6, Loopback 290, MA1 SMA 50, MA2 SMA 200.
 * Replayed bar-by-bar with NO look-ahead: a pivot at bar i is only known at the close of
 * bar i+10, and (like the Pine script) channels are recomputed only on bars where a new
 * pivot is confirmed. Channel width = 5% of the highest-high/lowest-low of the last 300 bars.
 * Bar t is evaluated against the channels as they stood at the close of bar t-1.
 *
 * Rules
 *   LONG : previous close above a channel (support) and bar low dips into it (low <= zone.hi)
 *          → within K bars (touch bar included) a bullish reversal candle closes
 *          (and no close below zone.lo in between) → enter at that candle's close.
 *   SHORT: mirror image at resistance.
 *   TP   : edge of the NEXT channel in the trade's direction (long → next zone's lower edge,
 *          short → next zone's upper edge). Mode "filter": trade taken only if that is >= MIN_TP
 *          points away. Mode "skip": use the nearest zone that is >= MIN_TP points away.
 *   SL   : a candle CLOSES below the support zone (long) / above the resistance zone (short)
 *          → exit at that close. No other stop, no time exit. One position at a time.
 *   Intrabar: if a bar trades through TP it is a TP (limit fill), checked before the close-SL.
 *
 * Reversal candle variants
 *   engulf+pin : bullish/bearish engulfing (body engulfs previous body) OR pin bar
 *                (rejection wick >= 2×body and >= 60% of the range)
 *   engulf     : engulfing only
 *   closeback  : candle in the trade direction that closes back outside the zone
 *
 * Usage: ts-node --project apps/api/tsconfig.json scripts/run-btc-srchannel-reversal-m30-backtest.ts \
 *   [startISO=2024-01-01] [minTpPts=400] [K=3] [feePctPerSide=0.05] [interval=30m|5m|15m|1h] [tpMode=zone|fixed]
 *   tpMode 'fixed': TP = entry ± minTpPts (no next-zone target / filter).
 *   [htf=ut30]: only long when the last closed M30 candle is above its UT Bot (10,3) stop, short when below.
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const SYMBOL = 'BTCUSDT';
const INTERVAL = process.argv[6] ?? '30m';
const BAR_MS = ({ '5m': 5, '15m': 15, '30m': 30, '1h': 60 } as Record<string, number>)[INTERVAL]! * 60 * 1000;

const PRD = 10, CHANNEL_W_PCT = 5, MIN_STRENGTH = 1, MAX_SR = 6, LOOPBACK = 290, WIDTH_BARS = 300;

type C = { t: number; o: number; h: number; l: number; c: number };
type Zone = { hi: number; lo: number; strength: number };

function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => { let d = ''; res.on('data', (x) => (d += x)); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}
async function fetchKlines(startMs: number, endMs: number, interval = INTERVAL): Promise<C[]> {
  const out: C[] = []; let cur = startMs;
  while (cur < endMs) {
    const batch = (await fetchJson(`${BINANCE_HOST}?symbol=${SYMBOL}&interval=${interval}&startTime=${cur}&endTime=${endMs}&limit=1000`)) as unknown[][];
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const k of batch) out.push({ t: k[0] as number, o: +(k[1] as string), h: +(k[2] as string), l: +(k[3] as string), c: +(k[4] as string) });
    if (batch.length < 1000) break;
    cur = (batch[batch.length - 1]![0] as number) + 1;
  }
  // drop the still-forming candle
  const barMs = ({ '5m': 5, '15m': 15, '30m': 30, '1h': 60 } as Record<string, number>)[interval]! * 6e4;
  return out.filter((x) => x.t + barMs <= Date.now());
}

/** zonesAfter[t] = S/R channels as known at the close of bar t (Pine: recomputed only on pivot bars). */
function replayChannels(c: C[]): Zone[][] {
  const n = c.length;
  const out: Zone[][] = new Array(n);
  const pivots: { idx: number; val: number }[] = [];
  let current: Zone[] = [];
  for (let t = 0; t < n; t++) {
    let newPivot = false;
    const i = t - PRD;
    if (i >= PRD) {
      let isH = true, isL = true;
      for (let j = i - PRD; j <= i + PRD; j++) {
        if (c[j]!.h > c[i]!.h) isH = false;
        if (c[j]!.l < c[i]!.l) isL = false;
      }
      if (isH) { pivots.push({ idx: i, val: c[i]!.h }); newPivot = true; }
      if (isL) { pivots.push({ idx: i, val: c[i]!.l }); newPivot = true; }
    }
    while (pivots.length && pivots[0]!.idx < t - LOOPBACK) pivots.shift();

    if (newPivot && pivots.length) {
      let hh = -Infinity, ll = Infinity;
      for (let j = Math.max(0, t - WIDTH_BARS + 1); j <= t; j++) { hh = Math.max(hh, c[j]!.h); ll = Math.min(ll, c[j]!.l); }
      const cwidth = ((hh - ll) * CHANNEL_W_PCT) / 100;
      const lbStart = Math.max(0, t - LOOPBACK);
      const cands = pivots.map(({ val: seed }) => {
        let lo = seed, hi = seed, count = 0;
        for (const { val: cpp } of pivots) {
          const w = cpp <= hi ? hi - cpp : cpp - lo;
          if (w <= cwidth) { if (cpp <= hi) lo = Math.min(lo, cpp); else hi = Math.max(hi, cpp); count++; }
        }
        let strength = count * 20;
        for (let j = lbStart; j <= t; j++) {
          const { h, l } = c[j]!;
          if ((h <= hi && h >= lo) || (l <= hi && l >= lo)) strength++;
        }
        return { hi, lo, strength, count };
      });
      cands.sort((a, b) => b.strength - a.strength);
      const sel: Zone[] = [];
      for (const ch of cands) {
        if (ch.count < MIN_STRENGTH) continue;
        if (sel.some((s) => ch.hi >= s.lo && ch.lo <= s.hi)) continue;
        sel.push({ hi: ch.hi, lo: ch.lo, strength: ch.strength });
        if (sel.length >= MAX_SR) break;
      }
      current = sel;
    }
    out[t] = current;
  }
  return out;
}

/** UT Bot Alerts trailing stop (Wilder ATR, same as packages/core/src/indicators/ut-bot.ts). */
function utBotStop(c: C[], period = 10, mult = 3): number[] {
  const atr = new Array(c.length).fill(0), stop = new Array(c.length).fill(0);
  const tr = c.map((x, i) => (i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - c[i - 1]!.c), Math.abs(x.l - c[i - 1]!.c))));
  let sum = 0; for (let i = 0; i < Math.min(period, c.length); i++) sum += tr[i]!;
  if (c.length >= period) atr[period - 1] = sum / period;
  for (let i = period; i < c.length; i++) atr[i] = (atr[i - 1]! * (period - 1) + tr[i]!) / period;
  for (let i = 0; i < c.length; i++) {
    const close = c[i]!.c, nLoss = atr[i]! * mult;
    if (nLoss === 0) continue;
    const ps = i > 0 ? stop[i - 1]! : 0, pc = i > 0 ? c[i - 1]!.c : 0;
    if (close > ps && pc > ps) stop[i] = Math.max(ps, close - nLoss);
    else if (close < ps && pc < ps) stop[i] = Math.min(ps, close + nLoss);
    else if (close > ps) stop[i] = close - nLoss;
    else stop[i] = close + nLoss;
  }
  return stop;
}

function sma(c: C[], len: number): number[] {
  const out = new Array(c.length).fill(NaN); let s = 0;
  for (let i = 0; i < c.length; i++) { s += c[i]!.c; if (i >= len) s -= c[i - len]!.c; if (i >= len - 1) out[i] = s / len; }
  return out;
}

type RevMode = 'engulf+pin' | 'engulf' | 'closeback';
type TpMode = 'filter' | 'skip' | 'fixed';
type Trade = { side: 'L' | 'S'; entryT: number; exitT: number; entry: number; exit: number; tp: number; zone: Zone; win: boolean; reason: 'TP' | 'SL' | 'TIME'; pts: number; net: number; bars: number };

function isReversal(c: C[], t: number, side: 'L' | 'S', zone: Zone, mode: RevMode): boolean {
  const b = c[t]!, p = c[t - 1]!;
  const range = b.h - b.l, body = Math.abs(b.c - b.o);
  if (side === 'L') {
    const engulf = b.c > b.o && p.c < p.o && b.c >= p.o && b.o <= p.c;
    const wick = Math.min(b.o, b.c) - b.l;
    const pin = range > 0 && wick >= 2 * body && wick >= 0.6 * range;
    if (mode === 'engulf') return engulf;
    if (mode === 'engulf+pin') return engulf || pin;
    return b.c > b.o && b.c > zone.hi;
  }
  const engulf = b.c < b.o && p.c > p.o && b.c <= p.o && b.o >= p.c;
  const wick = b.h - Math.max(b.o, b.c);
  const pin = range > 0 && wick >= 2 * body && wick >= 0.6 * range;
  if (mode === 'engulf') return engulf;
  if (mode === 'engulf+pin') return engulf || pin;
  return b.c < b.o && b.c < zone.lo;
}

function run(c: C[], zonesAfter: Zone[][], startIdx: number, o: { rev: RevMode; tpMode: TpMode; minTp: number; K: number; fee: number; trend: boolean; sma200: number[]; hours?: [number, number]; forceCloseHour?: number; htf?: (barCloseMs: number) => 'up' | 'down' | null }): Trade[] {
  const trades: Trade[] = [];
  const f = o.fee / 100;
  let pos: { side: 'L' | 'S'; entry: number; tp: number; zone: Zone; entryIdx: number } | null = null;
  let pendL: { zone: Zone; touch: number } | null = null, pendS: { zone: Zone; touch: number } | null = null;

  for (let t = Math.max(startIdx, 1); t < c.length; t++) {
    const b = c[t]!;
    if (pos) {
      let exit: number | null = null, win = false, reason: 'TP' | 'SL' | 'TIME' = 'SL';
      const bd = new Date(b.t);
      if (o.forceCloseHour !== undefined && bd.getUTCHours() === o.forceCloseHour && bd.getUTCMinutes() === 0) { exit = b.o; reason = 'TIME'; }
      else if (pos.side === 'L') { if (b.h >= pos.tp) { exit = pos.tp; win = true; } else if (b.c < pos.zone.lo) exit = b.c; }
      else { if (b.l <= pos.tp) { exit = pos.tp; win = true; } else if (b.c > pos.zone.hi) exit = b.c; }
      if (exit !== null) {
        const pts = pos.side === 'L' ? exit - pos.entry : pos.entry - exit;
        const net = pts - (pos.entry + exit) * f;
        trades.push({ side: pos.side, entryT: c[pos.entryIdx]!.t, exitT: b.t, entry: pos.entry, exit, tp: pos.tp, zone: pos.zone, win, reason: win ? 'TP' : reason, pts, net, bars: t - pos.entryIdx });
        pos = null;
      }
      continue; // one position at a time; no new setups on the exit bar
    }

    const Z = zonesAfter[t - 1]!;
    const prevC = c[t - 1]!.c;
    // new touches
    if (!pendL) {
      const sup = Z.filter((z) => prevC > z.hi && b.l <= z.hi).sort((a, z) => z.hi - a.hi)[0];
      if (sup) pendL = { zone: sup, touch: t };
    }
    if (!pendS) {
      const res = Z.filter((z) => prevC < z.lo && b.h >= z.lo).sort((a, z) => a.lo - z.lo)[0];
      if (res) pendS = { zone: res, touch: t };
    }

    const tryEnter = (side: 'L' | 'S', pend: { zone: Zone; touch: number }): boolean => {
      if (!isReversal(c, t, side, pend.zone, o.rev)) return false;
      if (o.htf) { const tr = o.htf(b.t + BAR_MS); if (tr === null || (side === 'L' && tr !== 'up') || (side === 'S' && tr !== 'down')) return false; }
      if (o.hours) { const h = new Date(b.t).getUTCHours(); if (h < o.hours[0] || h >= o.hours[1]) return false; }
      if (o.trend && Number.isFinite(o.sma200[t]!)) { if (side === 'L' && b.c < o.sma200[t]!) return false; if (side === 'S' && b.c > o.sma200[t]!) return false; }
      const entry = b.c;
      const zone = pend.zone;
      const ahead = side === 'L'
        ? Z.filter((z) => z !== zone && z.lo > entry).map((z) => z.lo).sort((a, z) => a - z)
        : Z.filter((z) => z !== zone && z.hi < entry).map((z) => z.hi).sort((a, z) => z - a);
      let tp: number | undefined;
      if (o.tpMode === 'fixed') tp = side === 'L' ? entry + o.minTp : entry - o.minTp;
      else if (o.tpMode === 'filter') { const nx = ahead[0]; if (nx !== undefined && Math.abs(nx - entry) >= o.minTp) tp = nx; }
      else tp = ahead.find((x) => Math.abs(x - entry) >= o.minTp);
      if (tp === undefined) return true; // setup consumed, no trade
      pos = { side, entry, tp, zone, entryIdx: t };
      return true;
    };

    for (const side of ['L', 'S'] as const) {
      const pend = side === 'L' ? pendL : pendS;
      if (!pend || pos) continue;
      const broke = side === 'L' ? b.c < pend.zone.lo : b.c > pend.zone.hi;
      let done = broke || tryEnter(side, pend);
      if (!done && t - pend.touch >= o.K - 1) done = true; // K bars incl. touch bar
      if (done) { if (side === 'L') pendL = null; else pendS = null; }
    }
    if (pos) { pendL = null; pendS = null; }
  }
  return trades;
}

const fmt = (n: number, d = 0) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const sgn = (n: number, d = 0) => (n >= 0 ? '+' : '-') + fmt(Math.abs(n), d);

function stats(tr: Trade[]) {
  const wins = tr.filter((x) => x.win);
  const losses = tr.filter((x) => x.net <= 0);
  const gw = tr.filter((x) => x.net > 0).reduce((s, x) => s + x.net, 0), gl = -losses.reduce((s, x) => s + x.net, 0);
  let eq = 0, peak = 0, dd = 0, streak = 0, maxStreak = 0;
  for (const x of tr) { eq += x.net; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); streak = x.net <= 0 ? streak + 1 : 0; maxStreak = Math.max(maxStreak, streak); }
  const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  return {
    n: tr.length, long: tr.filter((x) => x.side === 'L').length, tpRate: tr.length ? (wins.length / tr.length) * 100 : 0,
    gross: tr.reduce((s, x) => s + x.pts, 0), net: eq, pf: gl > 0 ? gw / gl : Infinity, dd, maxStreak,
    avgWin: avg(wins.map((x) => x.net)), avgLoss: avg(tr.filter((x) => !x.win).map((x) => x.net)), avgBars: avg(tr.map((x) => x.bars)),
  };
}

async function main() {
  const [, , startA, minTpA, kA, feeA] = process.argv;
  const startMs = Date.parse(startA ?? '2024-01-01T00:00:00Z');
  const minTp = Number(minTpA ?? 400), K = Number(kA ?? 3), fee = Number(feeA ?? 0.05);
  const c = await fetchKlines(startMs - 400 * BAR_MS, Date.now());
  const startIdx = c.findIndex((x) => x.t >= startMs);
  const zonesAfter = replayChannels(c);
  const sma200 = sma(c, 200);

  // argv[8] = 'ut30' → only trade in the direction of the M30 UT Bot (10,3) trend, read from
  // the last M30 candle that had CLOSED by the entry candle's close (no look-ahead).
  let htf: ((ms: number) => 'up' | 'down' | null) | undefined;
  if (process.argv[8] === 'ut30') {
    const h = await fetchKlines(startMs - 30 * 864e5, Date.now(), '30m');
    const st = utBotStop(h, 10, 3);
    const H_MS = 30 * 6e4;
    htf = (ms: number) => {
      let lo = 0, hi = h.length - 1, k = -1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (h[m]!.t + H_MS <= ms) { k = m; lo = m + 1; } else hi = m - 1; }
      if (k < 0 || st[k]! === 0) return null;
      return h[k]!.c > st[k]! ? 'up' : 'down';
    };
  }

  const d0 = new Date(c[startIdx]!.t).toISOString().slice(0, 10), d1 = new Date(c[c.length - 1]!.t).toISOString().slice(0, 16);
  console.log(`\n=== BTCUSDT ${INTERVAL} · SR Channel (10,H/L,5,1,6,290) bounce/rejection · ${d0} → ${d1} UTC · ${c.length - startIdx} bars ===`);
  console.log(`    ${htf ? 'TREND FILTER: M30 UT Bot (10,3) · ' : ''}${process.argv[7] === 'fixed' ? 'FIXED TP' : 'min TP'} ${minTp} pts · reversal window K=${K} bars · fee ${fee}%/side · P&L in USD per 1 BTC (= price points), net of fees\n`);

  // Session filter on the ENTRY candle's UTC open hour. Asia 00–08, Europe 08–13, US 13–21 (NYSE opens 13:30 UTC).
  const rows: { label: string; rev: RevMode; tpMode: TpMode; trend: boolean; hours?: [number, number]; forceCloseHour?: number }[] = [
    { label: 'all sessions (baseline)', rev: 'engulf+pin', tpMode: 'filter', trend: false },
    { label: 'MAIN Asia+EU 00-13 UTC', rev: 'engulf+pin', tpMode: 'filter', trend: false, hours: [0, 13] },
    { label: 'Asia only 00-08', rev: 'engulf+pin', tpMode: 'filter', trend: false, hours: [0, 8] },
    { label: 'EU only 08-13', rev: 'engulf+pin', tpMode: 'filter', trend: false, hours: [8, 13] },
    { label: 'US only 13-21 (contrast)', rev: 'engulf+pin', tpMode: 'filter', trend: false, hours: [13, 21] },
    { label: 'Asia+EU + force-close 13:00', rev: 'engulf+pin', tpMode: 'filter', trend: false, hours: [0, 13], forceCloseHour: 13 },
    { label: 'Asia+EU · engulf only', rev: 'engulf', tpMode: 'filter', trend: false, hours: [0, 13] },
    { label: 'Asia+EU · SMA200 trend', rev: 'engulf+pin', tpMode: 'filter', trend: true, hours: [0, 13] },
  ];
  console.log('  variant                              | trades (L/S) | TP% | avg win | avg loss |  PF  | gross pts | NET pts  | maxDD pts | max L-streak | avg hold');
  const results: Record<string, Trade[]> = {};
  const pctRows: string[] = [];
  // argv[7] = 'fixed' → TP = entry ± minTpPts for every variant (no next-zone target)
  if (process.argv[7] === 'fixed') for (const r of rows) r.tpMode = 'fixed';
  for (const r of rows) {
    const tr = run(c, zonesAfter, startIdx, { rev: r.rev, tpMode: r.tpMode, minTp, K, fee, trend: r.trend, sma200, hours: r.hours, forceCloseHour: r.forceCloseHour, htf });
    results[r.label] = tr;
    const s = stats(tr);
    const pct = (x: Trade) => x.pts / x.entry, pctNet = (x: Trade) => x.net / x.entry;
    const sumG = tr.reduce((a, x) => a + pct(x), 0) * 100, sumN = tr.reduce((a, x) => a + pctNet(x), 0) * 100;
    const cmpG = (tr.reduce((a, x) => a * (1 + pct(x)), 1) - 1) * 100, cmpN = (tr.reduce((a, x) => a * (1 + pctNet(x)), 1) - 1) * 100;
    let e = 1, pk = 1, mdd = 0; for (const x of tr) { e *= 1 + pct(x); pk = Math.max(pk, e); mdd = Math.max(mdd, (pk - e) / pk); }
    pctRows.push(`  ${r.label.padEnd(37)}| gross sum ${sgn(sumG, 1).padStart(7)}% · gross compounded ${sgn(cmpG, 1).padStart(7)}% (maxDD ${fmt(mdd * 100, 1)}%) | net sum ${sgn(sumN, 1).padStart(7)}% · net compounded ${sgn(cmpN, 1).padStart(7)}%`);
    console.log(`  ${r.label.padEnd(37)}| ${`${s.n} (${s.long}/${s.n - s.long})`.padStart(12)} | ${fmt(s.tpRate).padStart(3)}% | ${sgn(s.avgWin).padStart(7)} | ${sgn(s.avgLoss).padStart(8)} | ${(Number.isFinite(s.pf) ? s.pf.toFixed(2) : '∞').padStart(4)} | ${sgn(s.gross).padStart(9)} | ${sgn(s.net).padStart(8)} | ${fmt(s.dd).padStart(9)} | ${String(s.maxStreak).padStart(12)} | ${((s.avgBars * BAR_MS) / 36e5).toFixed(1)}h`);
  }

  console.log(`\n  % of account (1x, full account per trade)`);
  for (const l of pctRows) console.log(l);

  console.log(`\n  Stop-loss trades (loss per 1 BTC, fees excluded / included; % = of entry price)`);
  const q = (a: number[], p: number) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]!; };
  for (const r of rows) {
    const sl = results[r.label]!.filter((x) => x.reason === 'SL');
    const loss = sl.map((x) => -x.pts), lossN = sl.map((x) => -x.net), lp = sl.map((x) => (-x.pts / x.entry) * 100);
    const avg = (a: number[]) => a.reduce((u, v) => u + v, 0) / (a.length || 1);
    const tm = results[r.label]!.filter((x) => x.reason === 'TIME');
    console.log(`  ${r.label.padEnd(37)}| SL ${String(sl.length).padStart(3)} · avg $${fmt(avg(loss))} (net $${fmt(avg(lossN))}) · ${avg(lp).toFixed(2)}% · median $${fmt(q(loss, 0.5))} · p75 $${fmt(q(loss, 0.75))} · p90 $${fmt(q(loss, 0.9))} · max $${fmt(Math.max(...loss))}` + (tm.length ? ` | time-exit ${tm.length} · avg ${sgn(avg(tm.map((x) => x.pts)))}` : ''));
  }

  const main = results[rows[1]!.label]!;
  console.log(`\n  MAIN by year / side`);
  const years = [...new Set(main.map((x) => new Date(x.entryT).getUTCFullYear()))];
  for (const y of years) for (const side of ['L', 'S'] as const) {
    const s = stats(main.filter((x) => new Date(x.entryT).getUTCFullYear() === y && x.side === side));
    if (s.n) console.log(`    ${y} ${side === 'L' ? 'LONG ' : 'SHORT'} trades ${String(s.n).padStart(3)} · TP ${fmt(s.tpRate).padStart(3)}% · net ${sgn(s.net).padStart(8)} pts · PF ${Number.isFinite(s.pf) ? s.pf.toFixed(2) : '∞'}`);
  }
  console.log(`\n  MAIN last 12 trades`);
  for (const x of main.slice(-12)) {
    console.log(`    ${new Date(x.entryT).toISOString().slice(0, 16)} ${x.side === 'L' ? 'LONG ' : 'SHORT'} @${fmt(x.entry, 1)} zone ${fmt(x.zone.lo)}–${fmt(x.zone.hi)} TP ${fmt(x.tp)} → ${x.win ? 'TP ' : 'SL '} ${fmt(x.exit, 1)} (${new Date(x.exitT).toISOString().slice(5, 16)}) net ${sgn(x.net)}`);
  }
  console.log('');
}
main().catch((e) => { console.error(e); process.exit(1); });
