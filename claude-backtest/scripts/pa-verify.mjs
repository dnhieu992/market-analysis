#!/usr/bin/env node
/** Robustness of the PDH/PDL breakout (the one PA winner): per-year + long/short split.
 *  Configs: A) 1h none rr=2 (both dirs, no filter)  B) 1h trend rr=3 (EMA200-filtered). */
import { readFileSync } from 'node:fs';
const FEE = 0.05 / 100, RISK = 10, CD = '/var/tmp/sonicr-cache';
const c = JSON.parse(readFileSync(`${CD}/BTCUSDT-1h-2024-01-01.json`, 'utf8'));
const day = (ms) => Math.floor(ms / 864e5), yr = (ms) => new Date(ms).getUTCFullYear();
function ema(v, p) { const o = Array(v.length).fill(null); if (v.length < p) return o; const k = 2 / (p + 1); let e = v.slice(0, p).reduce((a, b) => a + b, 0) / p; o[p - 1] = e; for (let i = p; i < v.length; i++) { e = v[i] * k + e * (1 - k); o[i] = e; } return o; }
function atr(c, p = 14) { const o = Array(c.length).fill(null), tr = Array(c.length).fill(0); for (let i = 1; i < c.length; i++)tr[i] = Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close)); if (c.length <= p) return o; let a = tr.slice(1, p + 1).reduce((x, y) => x + y, 0) / p; o[p] = a; for (let i = p + 1; i < c.length; i++) { a = (a * (p - 1) + tr[i]) / p; o[i] = a; } return o; }
const cl = c.map((x) => x.close), e200 = ema(cl, 200), aA = atr(c, 14);
// per-day prev high/low
const days = []; let s = 0; for (let i = 1; i <= c.length; i++) { if (i === c.length || day(c[i].t) !== day(c[s].t)) { let h = -Infinity, l = Infinity; for (let j = s; j < i; j++) { if (c[j].high > h) h = c[j].high; if (c[j].low < l) l = c[j].low; } days.push({ start: s, end: i - 1, high: h, low: l }); s = i; } }
const prevH = Array(c.length), prevL = Array(c.length);
for (let d = 0; d < days.length; d++) { const ph = d > 0 ? days[d - 1].high : NaN, pl = d > 0 ? days[d - 1].low : NaN; for (let j = days[d].start; j <= days[d].end; j++) { prevH[j] = ph; prevL[j] = pl; } }
const sigs = [];
for (const d of days) { const ph = prevH[d.start], pl = prevL[d.start]; if (!(ph > 0)) continue; let done = false; for (let j = d.start; j <= d.end && !done; j++) { const a = aA[j] ?? c[j].close * 0.003; if (c[j].close > ph) { sigs.push({ i: j, dir: 1, sl: Math.min(c[j].low, pl) - 0.1 * a }); done = true; } else if (c[j].close < pl) { sigs.push({ i: j, dir: -1, sl: Math.max(c[j].high, ph) + 0.1 * a }); done = true; } } }

function runCfg(filter, rr) {
  const tr = []; let freeFrom = 0;
  for (const sg of sigs) {
    if (sg.i < freeFrom || sg.i + 1 >= c.length) continue;
    if (filter === 'trend') { if (e200[sg.i] == null) continue; if (sg.dir === 1 ? c[sg.i].close <= e200[sg.i] : c[sg.i].close >= e200[sg.i]) continue; }
    const ei = sg.i + 1; if (day(c[ei].t) !== day(c[sg.i].t)) continue;
    if (864e5 - (c[sg.i].t % 864e5) <= 36e5) continue;
    const entry = c[ei].open, risk = Math.abs(entry - sg.sl); if (!(risk > 0)) continue;
    const tp = sg.dir === 1 ? entry + rr * risk : entry - rr * risk, d = day(c[ei].t); let exit = null, xi = ei;
    for (let j = ei; j < c.length && j <= ei + 24; j++) { xi = j; if (day(c[j].t) !== d) { exit = c[j - 1].close; xi = j - 1; break; } if (sg.dir === 1 ? c[j].low <= sg.sl : c[j].high >= sg.sl) { exit = sg.sl; break; } if (sg.dir === 1 ? c[j].high >= tp : c[j].low <= tp) { exit = tp; break; } if (j === ei + 24) { exit = c[j].close; break; } }
    if (exit == null) continue;
    const size = RISK / risk, gross = size * (exit - entry) * sg.dir, fee = (size * entry + size * Math.abs(exit)) * FEE;
    tr.push({ R: (gross - fee) / RISK, net: gross - fee, dir: sg.dir, year: yr(c[ei].t) }); freeFrom = xi + 1;
  }
  return tr;
}
function st(ts) { const n = ts.length; if (!n) return '(none)'; let sr = 0, w = 0, gw = 0, gl = 0, net = 0, eq = 0, pk = 0, dd = 0; for (const t of ts) { sr += t.R; net += t.net; if (t.net > 0) { w++; gw += t.R; } else gl += Math.abs(t.R); eq += t.R; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); } return `n=${String(n).padStart(4)} WR=${(w / n * 100).toFixed(0)}% expR=${(sr / n).toFixed(3)} PF=${(gl ? gw / gl : 99).toFixed(2)} net$=${net.toFixed(0)} maxDD=${dd.toFixed(1)}R`; }

for (const [name, filter, rr] of [['A) 1h PDH/PDL breakout · no filter · RR2 (both dirs)', 'none', 2], ['B) 1h PDH/PDL breakout · trend(EMA200) · RR3', 'trend', 3]]) {
  const tr = runCfg(filter, rr);
  console.log(`\n${name}  (SL=level, fee 0.05%/side, risk $10, EOD close)`);
  console.log('  ALL  :', st(tr));
  for (const y of [2024, 2025, 2026]) console.log(`  ${y} :`, st(tr.filter((t) => t.year === y)));
  console.log('  LONG :', st(tr.filter((t) => t.dir === 1)));
  console.log('  SHORT:', st(tr.filter((t) => t.dir === -1)));
}
