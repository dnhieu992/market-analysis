/**
 * Plain-dollar P&L breakdown for the live swing pairs, 1 year.
 * For each config prints, per strategy: #trades, #wins, #losses, gross profit$, gross loss$,
 * fees$, net$ — using a FLAT $1000 per trade (no compounding) so the columns add up cleanly:
 *   net = grossProfit − grossLoss − fees.
 *
 * Strategies:
 *   A) CURRENT live exit  = UTBot flip-only (enter at flip, exit/reverse on flip, no TP).
 *   B) Partial 2.5×ATR    = bank half at +2.5×ATR(entry), runner rides the UTBot trail to the
 *                           flip, NO breakeven. (the risk-adjusted exit from the backtests)
 *
 * Usage: ts-node --project apps/api/tsconfig.json scripts/run-live-pnl-breakdown.ts [days] [feePctPerSide] [notional] [tpMult]
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const ATR_PERIOD = 10;
const PARTIAL_FRAC = 0.5;

const LIVE = [
  { symbol: 'ETHUSDT', interval: '4h', kv: 2 },
  { symbol: 'BTCUSDT', interval: '1d', kv: 2 },
  { symbol: 'BNBUSDT', interval: '4h', kv: 4 },
  { symbol: 'SOLUSDT', interval: '1d', kv: 2 },
];

type Candle = { open: number; high: number; low: number; close: number; openTime: Date };

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
    for (const k of batch) out.push({ open: +(k[1] as string), high: +(k[2] as string), low: +(k[3] as string), close: +(k[4] as string), openTime: new Date(k[0] as number) });
    if (batch.length < MAX_PER_REQ) break;
    cur = (batch[batch.length - 1]![0] as number) + 1;
  }
  return out;
}
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
const fmt = (n: number, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const usd = (n: number) => (n >= 0 ? '+$' : '-$') + fmt(Math.abs(n));

type Agg = { trades: number; wins: number; losses: number; grossProfit: number; grossLoss: number; fees: number };
function emptyAgg(): Agg { return { trades: 0, wins: 0, losses: 0, grossProfit: 0, grossLoss: 0, fees: 0 }; }
function addLeg(a: Agg, gross: number, fee: number) {
  a.trades++; a.fees += fee;
  if (gross >= 0) { a.wins++; a.grossProfit += gross; } else { a.losses++; a.grossLoss += -gross; }
}
const net = (a: Agg) => a.grossProfit - a.grossLoss - a.fees;

function run(candles: Candle[], kv: number, fee: number, notional: number, tpMult: number, mode: 'flip' | 'partial'): Agg {
  const stop = utBotStops(candles, ATR_PERIOD, kv);
  const atr = wilderAtr(candles, ATR_PERIOD);
  const f = fee / 100;
  const trendAt = (i: number) => (i < ATR_PERIOD || stop[i] === 0 ? null : candles[i]!.close > stop[i]! ? 'bull' : 'bear');
  const agg = emptyAgg();

  let prev: 'bull' | 'bear' | null = null;
  let dir: 'long' | 'short' | null = null;
  let entry = 0, eatr = 0, partialDone = false, legGross = 0, legFee = 0;

  const openLeg = (d: 'long' | 'short', px: number, a: number) => {
    dir = d; entry = px; eatr = a; partialDone = false;
    legGross = 0; legFee = notional * f; // open fee on full notional
  };
  const closeAll = (px: number) => {
    if (dir === null) return;
    const frac = partialDone ? PARTIAL_FRAC : 1; // remaining size
    const g = (dir === 'long' ? (px - entry) / entry : (entry - px) / entry) * notional * frac;
    legGross += g; legFee += notional * frac * f;
    addLeg(agg, legGross, legFee);
    dir = null;
  };

  for (let i = ATR_PERIOD; i < candles.length; i++) {
    const t = trendAt(i); if (t === null) continue;
    const c = candles[i]!;
    if (prev === null) { openLeg(t === 'bull' ? 'long' : 'short', c.close, atr[i]!); prev = t; continue; }
    if (t !== prev) { closeAll(c.close); openLeg(t === 'bull' ? 'long' : 'short', c.close, atr[i]!); prev = t; continue; }
    // same trend: partial TP check (intra-candle, optimistic)
    if (mode === 'partial' && dir !== null && !partialDone) {
      const tp = dir === 'long' ? entry + tpMult * eatr : entry - tpMult * eatr;
      const hit = dir === 'long' ? c.high >= tp : c.low <= tp;
      if (hit) {
        const g = (dir === 'long' ? (tp - entry) / entry : (entry - tp) / entry) * notional * PARTIAL_FRAC;
        legGross += g; legFee += notional * PARTIAL_FRAC * f;
        partialDone = true;
      }
    }
  }
  if (dir !== null) closeAll(candles[candles.length - 1]!.close);
  return agg;
}

function printRow(label: string, a: Agg) {
  console.log(
    `  ${label.padEnd(22)} | ${String(a.trades).padStart(6)} | ${String(a.wins).padStart(4)} | ${String(a.losses).padStart(4)} | ` +
      `${('+$' + fmt(a.grossProfit)).padStart(11)} | ${('-$' + fmt(a.grossLoss)).padStart(11)} | ${('-$' + fmt(a.fees)).padStart(8)} | ${usd(net(a)).padStart(11)}`,
  );
}

async function main() {
  const [, , daysArg, feeArg, notArg, tpArg] = process.argv;
  const days = Number(daysArg ?? 365), fee = Number(feeArg ?? 0.05), notional = Number(notArg ?? 1000), tpMult = Number(tpArg ?? 2.5);
  const endMs = Date.now(), startMs = endMs - days * 864e5;

  console.log(`\n=== LIVE swing P&L breakdown | ${days}d | $${notional}/trade FLAT (no compounding) | fee ${fee}%/side | partial ${tpMult}×ATR ===`);
  const tot = { flip: emptyAgg(), partial: emptyAgg() };
  for (const cfg of LIVE) {
    const candles = await fetchKlines(cfg.symbol, cfg.interval, startMs, endMs);
    const range = `${candles[0]?.openTime.toISOString().slice(0, 10)}→${candles[candles.length - 1]?.openTime.toISOString().slice(0, 10)}`;
    const flip = run(candles, cfg.kv, fee, notional, tpMult, 'flip');
    const part = run(candles, cfg.kv, fee, notional, tpMult, 'partial');
    console.log(`\n${cfg.symbol} ${cfg.interval} kv=${cfg.kv}   (${candles.length} candles, ${range})`);
    console.log('  strategy               | trades | win  | loss |   tổng lãi  |   tổng lỗ   |   phí    |    NET');
    printRow('CURRENT (flip-only)', flip);
    printRow(`Partial ${tpMult}xATR (no BE)`, part);
    for (const k of ['trades', 'wins', 'losses', 'grossProfit', 'grossLoss', 'fees'] as const) {
      tot.flip[k] += flip[k]; tot.partial[k] += part[k];
    }
  }
  console.log(`\n=== TOTAL (4 cặp live, $${notional}/lệnh) ===`);
  console.log('  strategy               | trades | win  | loss |   tổng lãi  |   tổng lỗ   |   phí    |    NET');
  printRow('CURRENT (flip-only)', tot.flip);
  printRow(`Partial ${tpMult}xATR (no BE)`, tot.partial);
  console.log('');
}
main().catch((e) => { console.error(e); process.exit(1); });
