#!/usr/bin/env node
/**
 * Per-year robustness for the v2 multi-timeframe winners (long-only, dragon pullback, fixed RR3):
 *   A) 1h  entry · htf = 4h & 1d   (best risk-adjusted, DD ~7R)
 *   B) 30m entry · htf = 1d        (best long net$, +$234)
 * Confirms whether the MTF gate makes the edge steadier than v1's 2024-only 1h edge.
 */
import { readFileSync } from 'node:fs';
const FEE = 0.05 / 100, RISK = 10, CD = '/var/tmp/sonicr-cache';
const TF_MS = { '30m': 18e5, '1h': 36e5, '4h': 144e5, '1d': 864e5 };
const L = (f) => JSON.parse(readFileSync(`${CD}/${f}`, 'utf8'));
function ema(v, p) { const o = Array(v.length).fill(null); if (v.length < p) return o; const k = 2 / (p + 1); let e = v.slice(0, p).reduce((a, b) => a + b, 0) / p; o[p - 1] = e; for (let i = p; i < v.length; i++) { e = v[i] * k + e * (1 - k); o[i] = e; } return o; }
function atr(c, p = 14) { const o = Array(c.length).fill(null), tr = Array(c.length).fill(0); for (let i = 1; i < c.length; i++)tr[i] = Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close)); if (c.length <= p) return o; let a = tr.slice(1, p + 1).reduce((x, y) => x + y, 0) / p; o[p] = a; for (let i = p + 1; i < c.length; i++) { a = (a * (p - 1) + tr[i]) / p; o[i] = a; } return o; }
const day = (ms) => Math.floor(ms / 864e5), yr = (ms) => new Date(ms).getUTCFullYear();
function htfState(c) { const cl = c.map((x) => x.close), e34 = ema(cl, 34), e89 = ema(cl, 89), e200 = ema(cl, 200); return { bull: c.map((_, i) => e34[i] > e89[i] && e89[i] > e200[i] && cl[i] > e89[i]), t: c.map((x) => x.t) }; }
function idx(st, hMs, sc) { let lo = 0, hi = st.t.length - 1, a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (st.t[m] + hMs <= sc) { a = m; lo = m + 1; } else hi = m - 1; } return a; }

const st4 = htfState(L('BTCUSDT-4h-2023-06-01.json')), st1d = htfState(L('BTCUSDT-1d-2023-06-01.json'));

function backtest(c, tf, htfs) {
  const cl = c.map((x) => x.close), hs = c.map((x) => x.high), ls = c.map((x) => x.low);
  const e34c = ema(cl, 34), e34h = ema(hs, 34), e34l = ema(ls, 34), e89 = ema(cl, 89), e200 = ema(cl, 200), a = atr(c, 14);
  const tfMs = TF_MS[tf], lb = 6, slAtr = 1, rr = 3, tr = [];
  let i = 210;
  while (i < c.length - 2) {
    if (!(e34c[i] > e89[i] && e89[i] > e200[i] && c[i].close > e89[i])) { i++; continue; } // long-only stacked bull
    const sc = c[i].t + tfMs - 1; let ok = true;
    for (const h of htfs) { const k = idx(h.st, TF_MS[h.tf], sc); if (k < 0 || !h.st.bull[k]) { ok = false; break; } }
    if (!ok) { i++; continue; }
    let sig = false; for (let j = i - lb + 1; j <= i; j++) { if (j < 0) continue; if (c[j].low <= e34h[j]) { sig = true; break; } }
    if (!(sig && c[i].close > c[i].open && c[i].close > e34c[i])) { i++; continue; }
    if (864e5 - (c[i].t % 864e5) <= tfMs) { i++; continue; }
    const ei = i + 1, entry = c[ei].open, win = c.slice(Math.max(0, i - lb + 1), i + 1);
    const sLow = Math.min(...win.map((x) => x.low)), av = a[i] ?? entry * 0.003, sl = Math.min(sLow, e34l[i]) - slAtr * av;
    const risk = entry - sl; if (!(risk > 0)) { i++; continue; }
    const tp = entry + rr * risk, d = day(c[ei].t); let exit = null;
    for (let j = ei; j < c.length && j <= ei + 48; j++) { if (day(c[j].t) !== d) { exit = c[j - 1].close; break; } if (c[j].low <= sl) { exit = sl; break; } if (c[j].high >= tp) { exit = tp; break; } if (j === ei + 48) { exit = c[j].close; break; } }
    if (exit == null) { i++; continue; }
    const size = RISK / risk, net = size * (exit - entry) - (size * entry + size * exit) * FEE;
    tr.push({ R: net / RISK, net, year: yr(c[ei].t) });
    let ci = ei; while (ci < c.length && day(c[ci].t) === d) { if (c[ci].low <= sl || c[ci].high >= tp) break; ci++; }
    i = Math.max(i + 1, ci + 1);
  }
  return tr;
}
function stats(ts) { const n = ts.length; if (!n) return '(none)'; let sr = 0, w = 0, gw = 0, gl = 0, net = 0, eq = 0, pk = 0, dd = 0; for (const t of ts) { sr += t.R; net += t.net; if (t.net > 0) { w++; gw += t.R; } else gl += Math.abs(t.R); eq += t.R; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); } return `n=${String(n).padStart(4)} WR=${(w / n * 100).toFixed(0)}% expR=${(sr / n).toFixed(3)} PF=${(gl ? gw / gl : 99).toFixed(2)} net$=${net.toFixed(0)} maxDD=${dd.toFixed(1)}R`; }

for (const [name, file, tf, htfs] of [
  ['A) 1h  dragon htf=4h&1d LONG', 'BTCUSDT-1h-2024-01-01.json', '1h', [{ tf: '4h', st: st4 }, { tf: '1d', st: st1d }]],
  ['B) 30m dragon htf=1d    LONG', 'BTCUSDT-30m-2024-01-01.json', '30m', [{ tf: '1d', st: st1d }]],
]) {
  const c = L(file), tr = backtest(c, tf, htfs);
  console.log(`\n${name}  (SL=1ATR, RR=3, lb=6, fee 0.05%/side, risk $10)`);
  console.log('  ALL :', stats(tr));
  for (const y of [2024, 2025, 2026]) console.log(`  ${y}:`, stats(tr.filter((t) => t.year === y)));
}
