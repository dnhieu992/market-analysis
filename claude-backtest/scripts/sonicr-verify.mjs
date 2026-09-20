#!/usr/bin/env node
/**
 * Robustness check on the ONE positive Sonic R day-trade config from the sweep:
 *   1h · dragon pullback · SL=1×ATR · RR=3 · lookback=6 · long-only · no trend-flip.
 * Splits results by calendar year (2024/2025/2026) to see if the edge is stable or
 * just one lucky regime. Also reports the exit-reason mix and R distribution.
 * Reads the cached 1h candles the sweep already downloaded.
 */
import { readFileSync } from 'node:fs';

const FEE_PCT = 0.05 / 100;
const RISK_USD = 10;
const CACHE = '/var/tmp/sonicr-cache/BTCUSDT-1h-2024-01-01.json';
const P = { target: 'dragon', slAtr: 1, rr: 3, lookback: 6, both: false, trendFlipExit: false };
const TF_MS_1H = 36e5;

const c = JSON.parse(readFileSync(CACHE, 'utf8'));
const closes = c.map((x) => x.close), highs = c.map((x) => x.high), lows = c.map((x) => x.low);

function emaArr(v, p) { const o = Array(v.length).fill(null); if (v.length < p) return o; const k = 2 / (p + 1); let e = v.slice(0, p).reduce((a, b) => a + b, 0) / p; o[p - 1] = e; for (let i = p; i < v.length; i++) { e = v[i] * k + e * (1 - k); o[i] = e; } return o; }
function atrArr(c, p = 14) { const o = Array(c.length).fill(null), tr = Array(c.length).fill(0); for (let i = 1; i < c.length; i++) tr[i] = Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close)); if (c.length <= p) return o; let a = tr.slice(1, p + 1).reduce((x, y) => x + y, 0) / p; o[p] = a; for (let i = p + 1; i < c.length; i++) { a = (a * (p - 1) + tr[i]) / p; o[i] = a; } return o; }

const e34c = emaArr(closes, 34), e34h = emaArr(highs, 34), e34l = emaArr(lows, 34), e89 = emaArr(closes, 89), e200 = emaArr(closes, 200), atr = atrArr(c, 14);
const utcDay = (ms) => Math.floor(ms / 864e5);
const yearOf = (ms) => new Date(ms).getUTCFullYear();

const trades = [];
let i = 210;
const barsPerDay = 24, tailBars = 1;
while (i < c.length - 2) {
  const bull = e34c[i] > e89[i] && e89[i] > e200[i] && c[i].close > e89[i];
  if (!bull) { i++; continue; }
  let touched = false;
  for (let j = i - P.lookback + 1; j <= i; j++) { if (j < 0) continue; if (c[j].low <= e34h[j]) touched = true; }
  if (!touched) { i++; continue; }
  if (!(c[i].close > c[i].open && c[i].close > e34c[i])) { i++; continue; }
  const secLeft = 864e5 - (c[i].t % 864e5);
  if (secLeft <= tailBars * TF_MS_1H) { i++; continue; }
  const ei0 = i + 1, entry = c[ei0].open;
  const structLow = Math.min(...c.slice(Math.max(0, i - P.lookback + 1), i + 1).map((x) => x.low));
  const a = atr[i] ?? entry * 0.003;
  const sl = Math.min(structLow, e34l[i]) - P.slAtr * a;
  const riskUnit = entry - sl;
  if (!(riskUnit > 0)) { i++; continue; }
  const tp = entry + P.rr * riskUnit, entryDay = utcDay(c[ei0].t);
  let exit = null, reason = null;
  for (let j = ei0; j < c.length && j <= ei0 + barsPerDay; j++) {
    if (utcDay(c[j].t) !== entryDay) { exit = c[j - 1].close; reason = 'eod'; break; }
    if (c[j].low <= sl) { exit = sl; reason = 'sl'; break; }
    if (c[j].high >= tp) { exit = tp; reason = 'tp'; break; }
    if (j === ei0 + barsPerDay) { exit = c[j].close; reason = 'time'; break; }
  }
  if (exit == null) { i++; continue; }
  const size = RISK_USD / riskUnit, gross = size * (exit - entry), fee = (size * entry + size * exit) * FEE_PCT;
  trades.push({ R: (gross - fee) / RISK_USD, net: gross - fee, reason, year: yearOf(c[ei0].t) });
  let ci = ei0;
  while (ci < c.length && utcDay(c[ci].t) === entryDay) { if (c[ci].low <= sl || c[ci].high >= tp) break; ci++; }
  i = Math.max(i + 1, ci + 1);
}

function stats(ts) {
  const n = ts.length; if (!n) return null;
  let sr = 0, w = 0, gw = 0, gl = 0, net = 0, eq = 0, pk = 0, dd = 0;
  const rc = {};
  for (const t of ts) { sr += t.R; net += t.net; if (t.net > 0) { w++; gw += t.R; } else gl += Math.abs(t.R); eq += t.R; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); rc[t.reason] = (rc[t.reason] || 0) + 1; }
  return { n, wr: w / n, expR: sr / n, pf: gl === 0 ? Infinity : gw / gl, net, dd, rc };
}
const fmt = (s) => `n=${String(s.n).padStart(4)} WR=${(s.wr * 100).toFixed(1)}% expR=${s.expR.toFixed(3)} PF=${s.pf.toFixed(2)} net$=${s.net.toFixed(0)} maxDD=${s.dd.toFixed(1)}R`;

console.log('Sonic R 1h · dragon pullback · SL=1ATR · RR=3 · lb=6 · LONG-ONLY · fee 0.05%/side · risk $10');
console.log('span:', new Date(c[0].t).toISOString().slice(0, 10), '→', new Date(c[c.length - 1].t).toISOString().slice(0, 10));
console.log('\nALL :', fmt(stats(trades)));
for (const y of [2024, 2025, 2026]) { const s = stats(trades.filter((t) => t.year === y)); console.log(`${y}:`, s ? fmt(s) : '(none)'); }
const all = stats(trades);
console.log('\nexit-reason mix:', JSON.stringify(all.rc), '→ EOD-close', ((all.rc.eod || 0) / all.n * 100).toFixed(0) + '%, TP', ((all.rc.tp || 0) / all.n * 100).toFixed(0) + '%, SL', ((all.rc.sl || 0) / all.n * 100).toFixed(0) + '%');
