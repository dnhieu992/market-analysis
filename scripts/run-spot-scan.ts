/**
 * Spot Scan — "find the next ZEC".
 *
 * ZEC ran ~97× ($15.78 on 2024-07-05 → $1,535 ATH on 2026-09-18). Its footprint before
 * and at liftoff:
 *   - DEEP drawdown from all-time high (a long-forgotten, beaten-down project),
 *   - a long, tight BASE near the lows (accumulation),
 *   - a REGIME FLIP: price reclaims its 200-day SMA after a long time below it,
 *   - VOLUME EXPANSION on the turn (30d avg volume ≫ its prior average),
 *   - a BREAKOUT of the multi-month base (new 60-day high), still EARLY (not yet parabolic).
 *
 * This script scores every coin in a universe (D1) on those five traits and ranks the
 * ones that most resemble the ZEC setup *right now*. It is a spot-accumulation screener,
 * NOT a timing/entry system — it surfaces candidates to research, not buy signals.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-spot-scan.ts [top] [symbolsCsv?]
 */
import * as https from 'https';

const HOST = 'https://api.binance.com/api/v3/klines';

// Universe skews toward old / deeply-drawn-down projects (ZEC's cohort): privacy coins,
// legacy L1s, DeFi 1.0, etc. Override with a comma list as the 2nd arg.
const UNIVERSE = [
  'ZEC','XMR','DASH','LTC','ETC','EOS','XLM','ALGO','ATOM','NEAR','FIL','ICP','EGLD','XTZ',
  'WAVES','ZIL','QTUM','ONT','IOTA','NEO','KSM','FLOW','ONE','ANKR','ROSE','KAVA','CELO',
  'SKL','STORJ','BAND','RSR','OCEAN','FET','INJ','GRT','1INCH','COMP','YFI','SNX','CRV',
  'SUSHI','ZRX','BAT','ENJ','CHZ','MANA','SAND','GALA','THETA','VET','HBAR','XTZ','DOT',
  'ADA','LINK','UNI','AAVE','MKR','LDO','RUNE','KDA','MINA','DYDX',
].map((s) => `${s}USDT`);

type C = { t: number; h: number; l: number; c: number; v: number };

function get(url: string): Promise<unknown> {
  return new Promise((res, rej) => {
    https.get(url, (r) => { let d = ''; r.on('data', (x) => (d += x)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
  });
}
async function klines(sym: string, startMs: number, endMs: number): Promise<C[]> {
  const out: C[] = []; let cur = startMs;
  while (cur < endMs) {
    const b = (await get(`${HOST}?symbol=${sym}&interval=1d&startTime=${cur}&endTime=${endMs}&limit=1000`)) as unknown[][];
    if (!Array.isArray(b) || !b.length) break;
    for (const k of b) out.push({ t: k[0] as number, h: +(k[2] as string), l: +(k[3] as string), c: +(k[4] as string), v: +(k[7] as string) });
    if (b.length < 1000) break; cur = (b[b.length - 1]![0] as number) + 1;
  }
  return out;
}

const smaAt = (a: number[], p: number, i: number) => i + 1 < p ? NaN : a.slice(i - p + 1, i + 1).reduce((s, x) => s + x, 0) / p;
const avg = (a: number[]) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;

function rsiLast(close: number[], period = 14): number {
  if (close.length < period + 1) return NaN;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i++) { const d = close[i]! - close[i - 1]!; if (d >= 0) g += d; else l -= d; }
  let ag = g / period, al = l / period;
  for (let i = period + 1; i < close.length; i++) {
    const d = close[i]! - close[i - 1]!;
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (al === 0) return 100;
  return 100 - 100 / (1 + ag / al);
}

type Row = {
  sym: string; price: number; ddFromAth: number; vs200: number; reclaimed: boolean;
  baseRatio: number; offLow: number; newHigh60: boolean; volExp: number; rsi: number; score: number; why: string[];
};

function evaluate(sym: string, cs: C[]): Row | null {
  if (cs.length < 220) return null;
  const close = cs.map((c) => c.c);
  const i = cs.length - 1;
  const price = close[i]!;
  const ath = Math.max(...cs.map((c) => c.h));
  const ddFromAth = (price / ath - 1) * 100;
  const s200 = smaAt(close, 200, i);
  const vs200 = (price / s200 - 1) * 100;
  // reclaimed the 200D within the last 30d (was below, now above) — the regime flip
  let below30 = false;
  for (let j = i - 30; j < i; j++) { if (j >= 200 && close[j]! < smaAt(close, 200, j)) { below30 = true; break; } }
  const reclaimed = price > s200 && below30;
  // base tightness over the accumulation window (days -150..-40 before now)
  const baseWin = cs.slice(i - 150, i - 40);
  const baseRatio = baseWin.length ? Math.max(...baseWin.map((c) => c.h)) / Math.min(...baseWin.map((c) => c.l)) : Infinity;
  const low180 = Math.min(...cs.slice(i - 180, i + 1).map((c) => c.l));
  const offLow = (price / low180 - 1) * 100;
  const high60 = Math.max(...cs.slice(i - 60, i).map((c) => c.h));
  const newHigh60 = price >= high60;
  const v30 = avg(cs.slice(i - 30, i + 1).map((c) => c.v));
  const v120 = avg(cs.slice(i - 120, i - 30).map((c) => c.v));
  const volExp = v120 ? v30 / v120 : NaN;
  const rsi = rsiLast(close);

  const why: string[] = [];
  let score = 0;
  // 1. Deep value — the ZEC cohort trait: far below ATH
  if (ddFromAth <= -60) { const pts = Math.min(25, 12 + (-ddFromAth - 60) / 3); score += pts; why.push(`ddATH ${ddFromAth.toFixed(0)}%`); }
  // 2. Regime flip — reclaim of the 200D
  if (reclaimed) { score += 25; why.push('reclaim 200D'); }
  else if (price > s200) { score += 10; why.push('above 200D'); }
  // 3. Tight base near the lows
  if (baseRatio < 2.0) { score += 15; why.push(`base ${baseRatio.toFixed(2)}×`); }
  else if (baseRatio < 2.6) { score += 8; why.push(`base ${baseRatio.toFixed(2)}×`); }
  // 4. Volume expansion
  if (volExp >= 1.3) { score += Math.min(15, 8 + (volExp - 1.3) * 10); why.push(`vol ${volExp.toFixed(1)}×`); }
  // 5. Breakout of base, still early (off the low but not parabolic yet)
  if (newHigh60) { score += 10; why.push('60d high'); }
  if (offLow >= 15 && offLow <= 150) { score += 10; why.push(`+${offLow.toFixed(0)}% off low`); }
  else if (offLow > 150) { why.push(`⚠ +${offLow.toFixed(0)}% off low (late)`); }
  if (rsi >= 55) { score += 5; why.push(`RSI ${rsi.toFixed(0)}`); }

  return { sym: sym.replace('USDT', ''), price, ddFromAth, vs200, reclaimed, baseRatio, offLow, newHigh60, volExp, rsi, score, why };
}

async function main() {
  const top = Number(process.argv[2] ?? 20);
  const syms = process.argv[3] ? process.argv[3].split(',').map((s) => s.trim().toUpperCase().replace(/USDT$/, '') + 'USDT') : UNIVERSE;
  const end = Date.now();
  const start = end - 400 * 864e5; // ~400d is enough for 200D SMA + base window

  console.log(`\nSpot Scan — "find the next ZEC" · D1 · ${syms.length} coins · ${new Date().toISOString().slice(0,10)}`);
  console.log('Criteria: deep drawdown + tight base + 200D reclaim + volume surge + early base breakout\n');

  const rows: Row[] = [];
  for (const s of syms) {
    try { const cs = await klines(s, start, end); const r = evaluate(s, cs); if (r) rows.push(r); }
    catch { /* skip unlisted */ }
  }
  rows.sort((a, b) => b.score - a.score);

  console.log('  rank  coin    score  price      ddATH   vs200   base   offLow   vol×   RSI   signals');
  rows.slice(0, top).forEach((r, k) => {
    console.log(
      `  ${String(k + 1).padStart(2)}.   ${r.sym.padEnd(6)}  ${String(Math.round(r.score)).padStart(3)}   ` +
      `${('$' + r.price.toPrecision(4)).padStart(9)}  ${(r.ddFromAth.toFixed(0)+'%').padStart(6)}  ${(r.vs200.toFixed(0)+'%').padStart(6)}  ` +
      `${r.baseRatio.toFixed(2)}×  ${('+'+r.offLow.toFixed(0)+'%').padStart(6)}  ${(isFinite(r.volExp)?r.volExp.toFixed(1):'—').padStart(4)}  ${r.rsi.toFixed(0).padStart(3)}   ${r.why.join(', ')}`
    );
  });
  console.log(`\n(${rows.length} coins scored; showing top ${Math.min(top, rows.length)}.)\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
