#!/usr/bin/env node
/**
 * Sonic R BTC day-trade backtest v2 — more scenarios + MULTI-TIMEFRAME + long/short split.
 *
 * New vs v1:
 *   - 3 setups:  dragon (pullback into EMA34) · river (pullback to EMA89) · breakout (N-bar high)
 *   - MULTI-TIMEFRAME trend gate (htf): require the higher TF's Sonic-R stack to agree with the
 *     entry, using only the last CLOSED higher-TF bar (no lookahead). htf ∈ none / 4h / 1d / 4h&1d.
 *   - 2 exits:   fixed RR=3  ·  ATR trailing stop (2×ATR from the high-water mark)
 *   - session filter: all hours  ·  active (12:00–22:00 UTC ≈ EU+US overlap)
 *   - LONG and SHORT tracked SEPARATELY so we can see why one side wins.
 *
 * Day-trade constraint unchanged: force-close at end of UTC day, no overnight, one position at a time.
 * Reads entry-TF candles from the v1 cache; fetches 4h/1d for the MTF gate. Zero repo imports.
 * Usage: node sonicr-v2.mjs [feePctPerSide=0.05] [riskUsd=10]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const SYMBOL = 'BTCUSDT';
const BINANCE = 'https://api.binance.com/api/v3/klines';
const MAX = 1000;
const CACHE_DIR = '/var/tmp/sonicr-cache';
const TF_MS = { '5m': 3e5, '15m': 9e5, '30m': 18e5, '1h': 36e5, '4h': 144e5, '1d': 864e5 };
const ENTRY_TFS = (process.env.TFS ? process.env.TFS.split(',') : ['5m', '15m', '30m', '1h']).map((s) => s.trim());
const FEE = Number(process.argv[2] ?? 0.05) / 100;
const RISK = Number(process.argv[3] ?? 10);
const START = '2024-01-01', START_MS = Date.parse('2024-01-01T00:00:00Z');
const HTF_START_MS = Date.parse('2023-06-01T00:00:00Z'); // warm EMA200 on 1d before 2024
const END_MS = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url) {
  for (let a = 0; a < 4; a++) { try { const r = await fetch(url, { signal: AbortSignal.timeout(30000) }); if (r.status === 429 || r.status === 418) { await sleep(2000 * (a + 1)); continue; } if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); } catch (e) { if (a === 3) throw e; await sleep(1000 * (a + 1)); } }
}
async function load(interval, startMs, tag) {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const f = `${CACHE_DIR}/${SYMBOL}-${interval}-${tag}.json`;
  if (existsSync(f)) { const c = JSON.parse(readFileSync(f, 'utf8')); if (c.length && END_MS - c[c.length - 1].t < 2 * 864e5) return c; }
  const out = []; let cur = startMs;
  while (cur < END_MS) {
    const b = await fetchJson(`${BINANCE}?symbol=${SYMBOL}&interval=${interval}&startTime=${cur}&endTime=${END_MS}&limit=${MAX}`);
    if (!Array.isArray(b) || !b.length) break;
    for (const k of b) out.push({ t: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4] });
    cur = b[b.length - 1][0] + TF_MS[interval]; if (b.length < MAX) break; await sleep(120);
  }
  writeFileSync(f, JSON.stringify(out)); return out;
}
function ema(v, p) { const o = Array(v.length).fill(null); if (v.length < p) return o; const k = 2 / (p + 1); let e = v.slice(0, p).reduce((a, b) => a + b, 0) / p; o[p - 1] = e; for (let i = p; i < v.length; i++) { e = v[i] * k + e * (1 - k); o[i] = e; } return o; }
function atr(c, p = 14) { const o = Array(c.length).fill(null), tr = Array(c.length).fill(0); for (let i = 1; i < c.length; i++)tr[i] = Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close)); if (c.length <= p) return o; let a = tr.slice(1, p + 1).reduce((x, y) => x + y, 0) / p; o[p] = a; for (let i = p + 1; i < c.length; i++) { a = (a * (p - 1) + tr[i]) / p; o[i] = a; } return o; }
const utcDay = (ms) => Math.floor(ms / 864e5);

/** Precompute higher-TF stacked-bull/bear per htf bar, + sorted close-times for lookup. */
function htfState(c) {
  const cl = c.map((x) => x.close), e34 = ema(cl, 34), e89 = ema(cl, 89), e200 = ema(cl, 200);
  const bull = c.map((_, i) => e34[i] != null && e89[i] != null && e200[i] != null && e34[i] > e89[i] && e89[i] > e200[i] && cl[i] > e89[i]);
  const bear = c.map((_, i) => e34[i] != null && e89[i] != null && e200[i] != null && e34[i] < e89[i] && e89[i] < e200[i] && cl[i] < e89[i]);
  const closeT = c.map((x) => x.t); // openTime; bar closes at openTime+tfMs
  return { bull, bear, closeT };
}
/** last htf index fully closed by signalCloseMs (no lookahead). */
function htfIdx(st, htfMs, signalCloseMs) {
  // find largest k with closeT[k] + htfMs <= signalCloseMs
  let lo = 0, hi = st.closeT.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (st.closeT[m] + htfMs <= signalCloseMs) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}

function run(c, ind, htf, p) {
  const { e34c, e34h, e34l, e89, e200, a, hi20 } = ind;
  const tfMs = TF_MS[p.tf];
  const trades = [];
  let i = 210;
  while (i < c.length - 2) {
    const bull = e34c[i] > e89[i] && e89[i] > e200[i] && c[i].close > e89[i];
    const bear = e34c[i] < e89[i] && e89[i] < e200[i] && c[i].close < e89[i];
    if (!bull && !bear) { i++; continue; }
    const dir = bull ? 1 : -1;

    // multi-timeframe gate
    if (p.htf.length) {
      const scMs = c[i].t + tfMs - 1;
      let ok = true;
      for (const h of p.htf) { const k = htfIdx(h.st, TF_MS[h.tf], scMs); if (k < 0 || (dir === 1 ? !h.st.bull[k] : !h.st.bear[k])) { ok = false; break; } }
      if (!ok) { i++; continue; }
    }
    // session filter
    if (p.session === 'active') { const hr = Math.floor((c[i].t % 864e5) / 36e5); if (hr < 12 || hr >= 22) { i++; continue; } }

    // setup trigger
    let sig = false;
    if (p.setup === 'dragon') {
      for (let j = i - p.lb + 1; j <= i; j++) { if (j < 0) continue; if (dir === 1 ? c[j].low <= e34h[j] : c[j].high >= e34l[j]) { sig = true; break; } }
      sig = sig && (dir === 1 ? c[i].close > c[i].open && c[i].close > e34c[i] : c[i].close < c[i].open && c[i].close < e34c[i]);
    } else if (p.setup === 'river') {
      for (let j = i - p.lb + 1; j <= i; j++) { if (j < 0) continue; if (dir === 1 ? c[j].low <= e89[j] : c[j].high >= e89[j]) { sig = true; break; } }
      sig = sig && (dir === 1 ? c[i].close > c[i].open && c[i].close > e34c[i] : c[i].close < c[i].open && c[i].close < e34c[i]);
    } else { // breakout of prior-20-bar high/low, in trend
      sig = dir === 1 ? c[i].close > hi20.hi[i - 1] : c[i].close < hi20.lo[i - 1];
    }
    if (!sig) { i++; continue; }
    const secLeft = 864e5 - (c[i].t % 864e5); if (secLeft <= tfMs) { i++; continue; }

    const ei = i + 1, entry = c[ei].open;
    const win = c.slice(Math.max(0, i - p.lb + 1), i + 1);
    const sLow = Math.min(...win.map((x) => x.low)), sHigh = Math.max(...win.map((x) => x.high));
    const av = a[i] ?? entry * 0.003;
    const sl0 = dir === 1 ? Math.min(sLow, e34l[i]) - p.slAtr * av : Math.max(sHigh, e34h[i]) + p.slAtr * av;
    const risk = Math.abs(entry - sl0); if (!(risk > 0)) { i++; continue; }
    const tp = dir === 1 ? entry + p.rr * risk : entry - p.rr * risk;
    const day = utcDay(c[ei].t);

    let exit = null, sl = sl0, hw = entry;
    for (let j = ei; j < c.length && j <= ei + 48; j++) {
      if (utcDay(c[j].t) !== day) { exit = c[j - 1].close; break; }
      if (dir === 1) {
        if (c[j].low <= sl) { exit = sl; break; }
        if (p.exit === 'fixed' && c[j].high >= tp) { exit = tp; break; }
        if (p.exit === 'trail') { hw = Math.max(hw, c[j].high); sl = Math.max(sl, hw - p.trail * av); }
      } else {
        if (c[j].high >= sl) { exit = sl; break; }
        if (p.exit === 'fixed' && c[j].low <= tp) { exit = tp; break; }
        if (p.exit === 'trail') { hw = Math.min(hw, c[j].low); sl = Math.min(sl, hw + p.trail * av); }
      }
      if (j === ei + 48) { exit = c[j].close; break; }
    }
    if (exit == null) { i++; continue; }
    const size = RISK / risk, gross = size * (exit - entry) * dir, fee = (size * entry + size * Math.abs(exit)) * FEE;
    trades.push({ R: (gross - fee) / RISK, net: gross - fee, dir });
    // advance past exit day-ish to avoid overlap
    let ci = ei; while (ci < c.length && utcDay(c[ci].t) === day) { if (dir === 1 ? c[ci].low <= sl0 : c[ci].high >= sl0) break; ci++; }
    i = Math.max(i + 1, ci + 1);
  }
  return trades;
}
function summ(ts) {
  const n = ts.length; if (!n) return null;
  let sr = 0, w = 0, gw = 0, gl = 0, net = 0, eq = 0, pk = 0, dd = 0;
  for (const t of ts) { sr += t.R; net += t.net; if (t.net > 0) { w++; gw += t.R; } else gl += Math.abs(t.R); eq += t.R; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); }
  return { n, wr: w / n, expR: sr / n, pf: gl === 0 ? 99 : gw / gl, net, dd };
}

async function main() {
  process.stderr.write('loading htf 4h/1d…\n');
  const c4 = await load('4h', HTF_START_MS, '2023-06-01'), c1d = await load('1d', HTF_START_MS, '2023-06-01');
  const st4 = htfState(c4), st1d = htfState(c1d);
  const htfOpts = { none: [], '4h': [{ tf: '4h', st: st4 }], '1d': [{ tf: '1d', st: st1d }], '4h&1d': [{ tf: '4h', st: st4 }, { tf: '1d', st: st1d }] };

  const rows = [], allLong = [], allShort = [];
  for (const tf of ENTRY_TFS) {
    process.stderr.write(`[${tf}] loading + indicators…\n`);
    const c = await load(tf, START_MS, START);
    const cl = c.map((x) => x.close), hs = c.map((x) => x.high), ls = c.map((x) => x.low);
    const hiArr = Array(c.length).fill(-Infinity), loArr = Array(c.length).fill(Infinity);
    for (let i = 0; i < c.length; i++) { let h = -Infinity, l = Infinity; for (let j = Math.max(0, i - 19); j <= i; j++) { if (hs[j] > h) h = hs[j]; if (ls[j] < l) l = ls[j]; } hiArr[i] = h; loArr[i] = l; }
    const ind = { e34c: ema(cl, 34), e34h: ema(hs, 34), e34l: ema(ls, 34), e89: ema(cl, 89), e200: ema(cl, 200), a: atr(c, 14), hi20: { hi: hiArr, lo: loArr } };
    const span = `${new Date(c[0].t).toISOString().slice(0, 10)}→${new Date(c[c.length - 1].t).toISOString().slice(0, 10)}`;
    for (const setup of ['dragon', 'river', 'breakout'])
      for (const htfKey of ['none', '4h', '1d', '4h&1d'])
        for (const exit of ['fixed', 'trail'])
          for (const session of ['all', 'active']) {
            const p = { tf, setup, htf: htfOpts[htfKey], htfKey, exit, session, slAtr: 1.0, rr: 3, lb: 6, trail: 2.0 };
            const ts = run(c, ind, null, p);
            const L = ts.filter((t) => t.dir === 1), S = ts.filter((t) => t.dir === -1);
            // Fair long-vs-short: pool only the SYMMETRIC trend-pullback setups (dragon/river),
            // so the comparison is "same setup, opposite side", not muddied by breakout momentum.
            if (setup === 'dragon' || setup === 'river') { allLong.push(...L); allShort.push(...S); }
            const both = summ(ts), sl = summ(L), ss = summ(S);
            if (both) rows.push({ tf, setup, htfKey, exit, session, both, L: sl, S: ss, span });
          }
    process.stderr.write(`[${tf}] done (${c.length} candles ${span})\n`);
  }

  const MIN = 100;
  const fmtS = (s) => s ? `n=${String(s.n).padStart(4)} WR=${(s.wr * 100).toFixed(0)}% expR=${s.expR.toFixed(3)} PF=${s.pf.toFixed(2)} net$=${s.net.toFixed(0)} DD=${s.dd.toFixed(0)}R` : '(none)';
  const label = (r) => `${r.tf.padEnd(3)} ${r.setup.padEnd(8)} htf=${r.htfKey.padEnd(5)} ${r.exit.padEnd(5)} ${r.session.padEnd(6)}`;

  console.log(`\n===== SONIC R DAY-TRADE v2 · ${SYMBOL} · fee ${(FEE * 100).toFixed(3)}%/side · risk $${RISK} · 2024→now =====`);

  // The headline question: LONG vs SHORT pooled over EVERY trade the whole sweep generated.
  console.log('\n##### WHY LONG, NOT SHORT — same trend-pullback setup, every trade pooled, long side vs short side #####');
  console.log('LONG  (dragon+river, all TFs/htf):', fmtS(summ(allLong)));
  console.log('SHORT (dragon+river, all TFs/htf):', fmtS(summ(allShort)));

  console.log('\n##### TOP 15 configs by COMBINED expectancy (n≥' + MIN + ', expR>0) #####');
  const ranked = rows.filter((r) => r.both.n >= MIN && r.both.expR > 0).sort((a, b) => b.both.expR - a.both.expR);
  ranked.slice(0, 15).forEach((r, i) => console.log(`${String(i + 1).padStart(2)}. ${label(r)} | ${fmtS(r.both)}`));

  console.log('\n##### Same top configs — LONG-ONLY vs SHORT-ONLY side by side #####');
  ranked.slice(0, 10).forEach((r) => console.log(`${label(r)}\n     L: ${fmtS(r.L)}\n     S: ${fmtS(r.S)}`));

  console.log('\n##### BEST config per entry timeframe (by combined expR, n≥' + MIN + ') #####');
  for (const tf of ENTRY_TFS) { const b = ranked.find((r) => r.tf === tf); console.log(b ? `${tf}: ${label(b)} | ${fmtS(b.both)}` : `${tf}: (no positive config)`); }

  console.log('\n##### Does MTF rescue the small timeframes? best net$ per (tf × htf), n≥' + MIN + ' #####');
  for (const tf of ENTRY_TFS) for (const h of ['none', '4h', '1d', '4h&1d']) {
    const b = rows.filter((r) => r.tf === tf && r.htfKey === h && r.both.n >= MIN).sort((a, b2) => b2.both.net - a.both.net)[0];
    console.log(`${tf} htf=${h.padEnd(5)}: ${b ? fmtS(b.both) + '  [' + b.setup + '/' + b.exit + '/' + b.session + ']' : '(none ≥' + MIN + ')'}`);
  }

  writeFileSync(`${CACHE_DIR}/v2-results.json`, JSON.stringify({ asOf: new Date().toISOString(), pooledLong: summ(allLong), pooledShort: summ(allShort), top: ranked.slice(0, 30) }, null, 2));
  console.log('\n(top-30 + pooled long/short → v2-results.json)');
}
main().catch((e) => { console.error(e.stack ?? e); process.exit(1); });
