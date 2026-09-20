#!/usr/bin/env node
/**
 * PRICE-ACTION BTC day-trade backtest — no EMAs in the SIGNAL, 2024→now, no overnight.
 *
 * Methods (each tested long & short, tracked separately):
 *   orb     Opening-Range Breakout — break of the day's first `orbH` hours range
 *   pdhl    Break of Previous-Day High / Low
 *   pdhlf   Fade of Previous-Day High / Low (test the level, close back inside → reverse)
 *   pin     Pin bar / rejection (long wick spearing a recent extreme)
 *   engulf  Bullish / bearish engulfing
 *   inside  Inside-bar breakout (break the mother bar after an inside bar)
 *
 * Filters (this is the multi-timeframe axis): none · trend (price vs EMA200 on entry TF) ·
 *   mtf (require the 1d Sonic-R stack to agree, last CLOSED 1d bar, no lookahead).
 * Exit: fixed RR (sweep) or end-of-day force close. One position at a time. fee 0.05%/side, risk $10.
 * Reads entry-TF + 1d caches already downloaded. Usage: node pa-daytrade.mjs [fee%=0.05] [risk=10]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const SYM = 'BTCUSDT', BINANCE = 'https://api.binance.com/api/v3/klines', MAXQ = 1000, CD = '/var/tmp/sonicr-cache';
const TF_MS = { '5m': 3e5, '15m': 9e5, '30m': 18e5, '1h': 36e5, '1d': 864e5 };
const ENTRY_TFS = (process.env.TFS ? process.env.TFS.split(',') : ['15m', '30m', '1h']).map((s) => s.trim());
const FEE = Number(process.argv[2] ?? 0.05) / 100, RISK = Number(process.argv[3] ?? 10);
const START = '2024-01-01', START_MS = Date.parse('2024-01-01T00:00:00Z');
const HTF_START = '2023-06-01', HTF_START_MS = Date.parse('2023-06-01T00:00:00Z');
const END_MS = Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const day = (ms) => Math.floor(ms / 864e5), yr = (ms) => new Date(ms).getUTCFullYear();

async function fetchJson(u) { for (let a = 0; a < 4; a++) { try { const r = await fetch(u, { signal: AbortSignal.timeout(30000) }); if (r.status === 429 || r.status === 418) { await sleep(2000 * (a + 1)); continue; } if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); } catch (e) { if (a === 3) throw e; await sleep(1000 * (a + 1)); } } }
async function load(interval, startMs, tag) {
  if (!existsSync(CD)) mkdirSync(CD, { recursive: true });
  const f = `${CD}/${SYM}-${interval}-${tag}.json`;
  if (existsSync(f)) { const c = JSON.parse(readFileSync(f, 'utf8')); if (c.length && END_MS - c[c.length - 1].t < 2 * 864e5) return c; }
  const out = []; let cur = startMs;
  while (cur < END_MS) { const b = await fetchJson(`${BINANCE}?symbol=${SYM}&interval=${interval}&startTime=${cur}&endTime=${END_MS}&limit=${MAXQ}`); if (!Array.isArray(b) || !b.length) break; for (const k of b) out.push({ t: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4] }); cur = b[b.length - 1][0] + TF_MS[interval]; if (b.length < MAXQ) break; await sleep(120); }
  writeFileSync(f, JSON.stringify(out)); return out;
}
function ema(v, p) { const o = Array(v.length).fill(null); if (v.length < p) return o; const k = 2 / (p + 1); let e = v.slice(0, p).reduce((a, b) => a + b, 0) / p; o[p - 1] = e; for (let i = p; i < v.length; i++) { e = v[i] * k + e * (1 - k); o[i] = e; } return o; }
function atr(c, p = 14) { const o = Array(c.length).fill(null), tr = Array(c.length).fill(0); for (let i = 1; i < c.length; i++)tr[i] = Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close)); if (c.length <= p) return o; let a = tr.slice(1, p + 1).reduce((x, y) => x + y, 0) / p; o[p] = a; for (let i = p + 1; i < c.length; i++) { a = (a * (p - 1) + tr[i]) / p; o[i] = a; } return o; }
function htfState(c) { const cl = c.map((x) => x.close), e34 = ema(cl, 34), e89 = ema(cl, 89), e200 = ema(cl, 200); return { bull: c.map((_, i) => e34[i] > e89[i] && e89[i] > e200[i] && cl[i] > e89[i]), bear: c.map((_, i) => e34[i] < e89[i] && e89[i] < e200[i] && cl[i] < e89[i]), t: c.map((x) => x.t) }; }
function htfIdx(st, hMs, sc) { let lo = 0, hi = st.t.length - 1, a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (st.t[m] + hMs <= sc) { a = m; lo = m + 1; } else hi = m - 1; } return a; }

/** Per-day structure: [startIdx, prevHigh, prevLow] and day list. */
function dayInfo(c) {
  const days = []; let s = 0;
  for (let i = 1; i <= c.length; i++) { if (i === c.length || day(c[i].t) !== day(c[s].t)) { let h = -Infinity, l = Infinity; for (let j = s; j < i; j++) { if (c[j].high > h) h = c[j].high; if (c[j].low < l) l = c[j].low; } days.push({ start: s, end: i - 1, high: h, low: l }); s = i; } }
  const startOf = new Array(c.length), prevH = new Array(c.length), prevL = new Array(c.length);
  for (let d = 0; d < days.length; d++) { const ph = d > 0 ? days[d - 1].high : NaN, pl = d > 0 ? days[d - 1].low : NaN; for (let j = days[d].start; j <= days[d].end; j++) { startOf[j] = days[d].start; prevH[j] = ph; prevL[j] = pl; } }
  return { days, startOf, prevH, prevL };
}

// ---- signal generators: return [{i, dir, sl}] decided at CLOSE of bar i (enter next open) ----
function sigORB(c, di, atrA, orbH) {
  const out = []; const winMs = orbH * 36e5;
  for (const d of di.days) {
    const dayStart = c[d.start].t; let orh = -Infinity, orl = Infinity, k = d.start;
    while (k <= d.end && c[k].t < dayStart + winMs) { if (c[k].high > orh) orh = c[k].high; if (c[k].low < orl) orl = c[k].low; k++; }
    if (!(orh > orl)) continue;
    let didL = false, didS = false;
    for (let j = k; j <= d.end; j++) {
      if (!didL && c[j].close > orh) { out.push({ i: j, dir: 1, sl: orl }); didL = true; }
      if (!didS && c[j].close < orl) { out.push({ i: j, dir: -1, sl: orh }); didS = true; }
      if (didL && didS) break;
    }
  }
  return out;
}
function sigPDHL(c, di, atrA, fade) {
  const out = [];
  for (const d of di.days) {
    const ph = di.prevH[d.start], pl = di.prevL[d.start]; if (!(ph > 0)) continue;
    let done = false;
    for (let j = d.start; j <= d.end && !done; j++) {
      const a = atrA[j] ?? c[j].close * 0.003;
      if (!fade) {
        if (c[j].close > ph) { out.push({ i: j, dir: 1, sl: Math.min(c[j].low, pl) - 0.1 * a }); done = true; }
        else if (c[j].close < pl) { out.push({ i: j, dir: -1, sl: Math.max(c[j].high, ph) + 0.1 * a }); done = true; }
      } else { // fade: tested the level then closed back inside
        if (c[j].high >= ph && c[j].close < ph && c[j].close < c[j].open) { out.push({ i: j, dir: -1, sl: c[j].high + 0.2 * a }); done = true; }
        else if (c[j].low <= pl && c[j].close > pl && c[j].close > c[j].open) { out.push({ i: j, dir: 1, sl: c[j].low - 0.2 * a }); done = true; }
      }
    }
  }
  return out;
}
function sigPin(c, atrA) {
  const out = [];
  for (let i = 3; i < c.length; i++) {
    const body = Math.abs(c[i].close - c[i].open), rng = c[i].high - c[i].low; if (rng <= 0 || body <= 0) continue;
    const up = c[i].high - Math.max(c[i].close, c[i].open), dn = Math.min(c[i].close, c[i].open) - c[i].low;
    const recLow = Math.min(c[i - 1].low, c[i - 2].low, c[i - 3].low), recHigh = Math.max(c[i - 1].high, c[i - 2].high, c[i - 3].high);
    const a = atrA[i] ?? c[i].close * 0.003;
    if (dn >= 2 * body && up <= body && c[i].low <= recLow) out.push({ i, dir: 1, sl: c[i].low - 0.1 * a });
    else if (up >= 2 * body && dn <= body && c[i].high >= recHigh) out.push({ i, dir: -1, sl: c[i].high + 0.1 * a });
  }
  return out;
}
function sigEngulf(c, atrA) {
  const out = [];
  for (let i = 1; i < c.length; i++) {
    const a = atrA[i] ?? c[i].close * 0.003;
    const bull = c[i - 1].close < c[i - 1].open && c[i].close > c[i].open && c[i].close >= c[i - 1].open && c[i].open <= c[i - 1].close;
    const bear = c[i - 1].close > c[i - 1].open && c[i].close < c[i].open && c[i].close <= c[i - 1].open && c[i].open >= c[i - 1].close;
    if (bull) out.push({ i, dir: 1, sl: Math.min(c[i].low, c[i - 1].low) - 0.1 * a });
    else if (bear) out.push({ i, dir: -1, sl: Math.max(c[i].high, c[i - 1].high) + 0.1 * a });
  }
  return out;
}
function sigInside(c) {
  const out = [];
  for (let i = 2; i < c.length; i++) {
    const inside = c[i - 1].high <= c[i - 2].high && c[i - 1].low >= c[i - 2].low;
    if (!inside) continue;
    if (c[i].close > c[i - 2].high) out.push({ i, dir: 1, sl: c[i - 2].low });
    else if (c[i].close < c[i - 2].low) out.push({ i, dir: -1, sl: c[i - 2].high });
  }
  return out;
}

function passFilter(c, e200, i, dir, filter, mtf) {
  if (filter === 'none') return true;
  if (filter === 'trend') { if (e200[i] == null) return false; return dir === 1 ? c[i].close > e200[i] : c[i].close < e200[i]; }
  // mtf: 1d stack agrees
  const k = htfIdx(mtf.st, TF_MS['1d'], c[i].t + mtf.tfMs - 1); if (k < 0) return false;
  return dir === 1 ? mtf.st.bull[k] : mtf.st.bear[k];
}
function simulate(c, e200, sigs, cfg, mtf) {
  const tr = []; let freeFrom = 0;
  for (const s of sigs) {
    if (s.i < freeFrom || s.i + 1 >= c.length) continue;
    if (!passFilter(c, e200, s.i, s.dir, cfg.filter, mtf)) continue;
    const ei = s.i + 1; if (day(c[ei].t) !== day(c[s.i].t)) continue;
    if (864e5 - (c[s.i].t % 864e5) <= cfg.tfMs) continue;
    const entry = c[ei].open, risk = Math.abs(entry - s.sl); if (!(risk > 0)) continue;
    const dir = s.dir, tp = dir === 1 ? entry + cfg.rr * risk : entry - cfg.rr * risk, d = day(c[ei].t);
    let exit = null, xi = ei;
    for (let j = ei; j < c.length && j <= ei + cfg.maxHold; j++) {
      xi = j;
      if (day(c[j].t) !== d) { exit = c[j - 1].close; xi = j - 1; break; }
      if (dir === 1) { if (c[j].low <= s.sl) { exit = s.sl; break; } if (c[j].high >= tp) { exit = tp; break; } }
      else { if (c[j].high >= s.sl) { exit = s.sl; break; } if (c[j].low <= tp) { exit = tp; break; } }
      if (j === ei + cfg.maxHold) { exit = c[j].close; break; }
    }
    if (exit == null) continue;
    const size = RISK / risk, gross = size * (exit - entry) * dir, fee = (size * entry + size * Math.abs(exit)) * FEE;
    tr.push({ R: (gross - fee) / RISK, net: gross - fee, dir, year: yr(c[ei].t) });
    freeFrom = xi + 1;
  }
  return tr;
}
function summ(ts) { const n = ts.length; if (!n) return null; let sr = 0, w = 0, gw = 0, gl = 0, net = 0, eq = 0, pk = 0, dd = 0; for (const t of ts) { sr += t.R; net += t.net; if (t.net > 0) { w++; gw += t.R; } else gl += Math.abs(t.R); eq += t.R; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); } return { n, wr: w / n, expR: sr / n, pf: gl ? gw / gl : 99, net, dd }; }
const fmt = (s) => s ? `n=${String(s.n).padStart(4)} WR=${(s.wr * 100).toFixed(0)}% expR=${s.expR.toFixed(3)} PF=${s.pf.toFixed(2)} net$=${s.net.toFixed(0)} DD=${s.dd.toFixed(0)}R` : '(none)';

async function main() {
  process.stderr.write('loading 1d for MTF…\n');
  const st1d = htfState(await load('1d', HTF_START_MS, HTF_START));
  const rows = [], pooled = { L: {}, S: {} };
  for (const tf of ENTRY_TFS) {
    process.stderr.write(`[${tf}] loading…\n`);
    const c = await load(tf, START_MS, START), cl = c.map((x) => x.close), e200 = ema(cl, 200), a = atr(c, 14), di = dayInfo(c);
    const mtf = { st: st1d, tfMs: TF_MS[tf] };
    const gens = {
      orb1: sigORB(c, di, a, 1), orb2: sigORB(c, di, a, 2), orb4: sigORB(c, di, a, 4),
      pdhl: sigPDHL(c, di, a, false), pdhlf: sigPDHL(c, di, a, true),
      pin: sigPin(c, a), engulf: sigEngulf(c, a), inside: sigInside(c),
    };
    for (const [method, sigs] of Object.entries(gens))
      for (const filter of ['none', 'trend', 'mtf'])
        for (const rr of [1.5, 2, 3]) {
          const cfg = { filter, rr, tfMs: TF_MS[tf], maxHold: Math.ceil(1440 / (TF_MS[tf] / 60000)) };
          const ts = simulate(c, e200, sigs, cfg, mtf);
          const L = ts.filter((t) => t.dir === 1), S = ts.filter((t) => t.dir === -1);
          (pooled.L[method] ??= []).push(...L); (pooled.S[method] ??= []).push(...S);
          const both = summ(ts); if (both) rows.push({ tf, method, filter, rr, both, L: summ(L), S: summ(S) });
        }
    process.stderr.write(`[${tf}] done (${c.length} candles)\n`);
  }

  const MIN = 80;
  const label = (r) => `${r.tf.padEnd(3)} ${r.method.padEnd(6)} ${r.filter.padEnd(5)} rr=${r.rr}`;
  console.log(`\n===== PRICE-ACTION DAY-TRADE · ${SYM} · fee ${(FEE * 100).toFixed(3)}%/side · risk $${RISK} · 2024→now =====`);

  const ranked = rows.filter((r) => r.both.n >= MIN && r.both.expR > 0).sort((x, y) => y.both.expR - x.both.expR);
  console.log(`configs with trades: ${rows.length}; passing (n≥${MIN}, expR>0): ${ranked.length}\n`);
  console.log('##### TOP 20 by combined expectancy #####');
  ranked.slice(0, 20).forEach((r, i) => console.log(`${String(i + 1).padStart(2)}. ${label(r).padEnd(26)} | ${fmt(r.both)}`));

  console.log('\n##### Best per METHOD (any TF/filter/rr, n≥' + MIN + ') #####');
  for (const m of ['orb1', 'orb2', 'orb4', 'pdhl', 'pdhlf', 'pin', 'engulf', 'inside']) {
    const b = ranked.find((r) => r.method === m) || rows.filter((r) => r.method === m && r.both.n >= MIN).sort((x, y) => y.both.expR - x.both.expR)[0];
    console.log(`${m.padEnd(7)}: ${b ? label(b).padEnd(26) + ' | ' + fmt(b.both) : '(no config ≥' + MIN + ' trades)'}`);
  }

  console.log('\n##### LONG vs SHORT pooled per method (all TF/filter/rr) #####');
  for (const m of Object.keys(pooled.L)) console.log(`${m.padEnd(7)}  L: ${fmt(summ(pooled.L[m]))}\n         S: ${fmt(summ(pooled.S[m]))}`);

  writeFileSync(`${CD}/pa-results.json`, JSON.stringify({ asOf: new Date().toISOString(), top: ranked.slice(0, 30) }, null, 2));
  console.log('\n(top-30 → pa-results.json)');
}
main().catch((e) => { console.error(e.stack ?? e); process.exit(1); });
