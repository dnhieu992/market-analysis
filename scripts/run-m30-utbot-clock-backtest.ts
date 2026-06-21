/**
 * M30 UTBot directional clock trade.
 *   At 00:00 UTC: look at the M30 UTBot trend (last CLOSED 30m candle = 23:30).
 *     - bull → LONG · bear → SHORT  (entry at the 00:00 candle open)
 *   TP = 0.5% (in trade direction). NO stop. Force-close at 08:00 UTC (open of the 08:00 candle).
 *   Fixed $notional/trade, fee feePct%/side. UTBot = Wilder ATR(p) trailing stop, nLoss = kv×ATR.
 *
 * Usage: ts-node --project apps/api/tsconfig.json scripts/run-m30-utbot-clock-backtest.ts \
 *   [days] [feePctPerSide] [notional] [tpPct] [exitHour] [kv] [atrPeriod]
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const INTERVAL = '30m';
const SYMBOLS = (process.env.SYMBOLS ?? 'BTCUSDT,ETHUSDT,BNBUSDT,SOLUSDT').split(',');
const ENTRY_HOUR = 0, DAY_MS = 864e5;

type Candle = { open: number; high: number; low: number; close: number; hour: number; min: number; t: number };

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
    for (const k of batch) { const ms = k[0] as number, t = new Date(ms); out.push({ open: +(k[1] as string), high: +(k[2] as string), low: +(k[3] as string), close: +(k[4] as string), hour: t.getUTCHours(), min: t.getUTCMinutes(), t: ms }); }
    if (batch.length < MAX_PER_REQ) break;
    cur = (batch[batch.length - 1]![0] as number) + 1;
  }
  return out;
}
const fmt = (n: number, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const usd = (n: number) => (n >= 0 ? '+$' : '-$') + fmt(Math.abs(n));

function wilderAtr(c: Candle[], p: number): number[] {
  const n = c.length;
  const tr = c.map((x, i) => (i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1]!.close), Math.abs(x.low - c[i - 1]!.close))));
  const atr = new Array(n).fill(0); let s = 0;
  for (let i = 0; i < p; i++) s += tr[i]!;
  atr[p - 1] = s / p;
  for (let i = p; i < n; i++) atr[i] = (atr[i - 1]! * (p - 1) + tr[i]!) / p;
  return atr;
}
function utBotStops(c: Candle[], p: number, kv: number): number[] {
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

type Res = { trades: number; longs: number; shorts: number; tpHits: number; net: number; gross: number; wins: number };

function run(c: Candle[], notional: number, feePct: number, tpPct: number, exitHour: number, kv: number, atrP: number, winStartMs: number): Res {
  const stop = utBotStops(c, atrP, kv);
  const f = feePct / 100, tp = tpPct / 100;
  const r: Res = { trades: 0, longs: 0, shorts: 0, tpHits: 0, net: 0, gross: 0, wins: 0 };
  for (let i = 0; i < c.length; i++) {
    if (c[i]!.hour !== ENTRY_HOUR || c[i]!.min !== 0 || c[i]!.t < winStartMs) continue;
    if (i === 0 || stop[i - 1]! === 0) continue;
    const prev = c[i - 1]!;                      // last closed M30 candle before 00:00
    const dir: 'long' | 'short' = prev.close > stop[i - 1]! ? 'long' : 'short';
    const entry = c[i]!.open;
    const tpPx = dir === 'long' ? entry * (1 + tp) : entry * (1 - tp);
    let exitRet: number | null = null, hitTP = false;
    for (let j = i; j < c.length; j++) {
      if (j > i && c[j]!.hour === exitHour && c[j]!.min === 0) { exitRet = dir === 'long' ? (c[j]!.open - entry) / entry : (entry - c[j]!.open) / entry; break; }
      const hit = dir === 'long' ? c[j]!.high >= tpPx : c[j]!.low <= tpPx;
      if (hit) { exitRet = tp; hitTP = true; break; }
      if (j - i > 24) { exitRet = dir === 'long' ? (c[j]!.close - entry) / entry : (entry - c[j]!.close) / entry; break; }
    }
    if (exitRet === null) continue;
    r.trades++; if (dir === 'long') r.longs++; else r.shorts++;
    r.gross += notional * exitRet; r.net += notional * ((1 + exitRet) * (1 - f) * (1 - f) - 1);
    if (hitTP) r.tpHits++; if (exitRet >= 0) r.wins++;
  }
  return r;
}

async function main() {
  const [, , daysA, feeA, notA, tpA, ehA, kvA, atrA, altTpA] = process.argv;
  const days = Number(daysA ?? 365), fee = Number(feeA ?? 0.05), notional = Number(notA ?? 1000), tpPct = Number(tpA ?? 0.5), exitHour = Number(ehA ?? 8), kv = Number(kvA ?? 2), atrP = Number(atrA ?? 10);
  const altTpPct = Number(altTpA ?? tpPct); // alts (everything except BTC) use this TP
  const tpFor = (sym: string) => (sym === 'BTCUSDT' ? tpPct : altTpPct);
  const endMs = Date.now(), winStartMs = endMs - days * DAY_MS, warmStartMs = winStartMs - 10 * DAY_MS;

  console.log(`\n=== M30 UTBot CLOCK · 00:00 UTC entry (bull→long / bear→short) · TP BTC ${tpPct}% / alts ${altTpPct}% · force-close ${String(exitHour).padStart(2, '0')}:00 · NO stop · UTBot kv${kv}/ATR${atrP} · ${days}d · $${notional}/trade · fee ${fee}%/side ===\n`);
  console.log('  symbol     | TP%  | trades |  L /  S | TP hit | winRate |  GROSS $  | total fees |   NET $   | net/trade');
  let T: Res = { trades: 0, longs: 0, shorts: 0, tpHits: 0, net: 0, gross: 0, wins: 0 };
  for (const sym of SYMBOLS) {
    const c = await fetchKlines(sym, INTERVAL, warmStartMs, endMs);
    const r = run(c, notional, fee, tpFor(sym), exitHour, kv, atrP, winStartMs);
    const wr = r.trades ? (r.wins / r.trades) * 100 : 0;
    console.log(
      `  ${sym.padEnd(10)} | ${(fmt(tpFor(sym), 1) + '%').padStart(4)} | ${String(r.trades).padStart(6)} | ${String(r.longs).padStart(2)} /${String(r.shorts).padStart(3)} | ${String(r.tpHits).padStart(6)} | ${(fmt(wr, 1) + '%').padStart(7)} | ` +
        `${usd(r.gross).padStart(9)} | ${usd(-(r.gross - r.net)).padStart(10)} | ${usd(r.net).padStart(9)} | ${usd(r.trades ? r.net / r.trades : 0).padStart(8)}`,
    );
    T.trades += r.trades; T.longs += r.longs; T.shorts += r.shorts; T.tpHits += r.tpHits; T.net += r.net; T.gross += r.gross; T.wins += r.wins;
  }
  console.log('\n  TOTAL (4 syms): ' + `${T.trades} trades (${T.longs}L/${T.shorts}S) · TP hit ${T.tpHits} · winRate ${fmt(T.trades ? (T.wins / T.trades) * 100 : 0, 1)}% · GROSS ${usd(T.gross)} · NET ${usd(T.net)} · ${usd(T.trades ? T.net / T.trades : 0)}/trade\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
