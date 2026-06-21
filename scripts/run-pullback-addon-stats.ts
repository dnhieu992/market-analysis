/**
 * Isolated statistics for the PULLBACK add-on (scale-in) legs only.
 *
 * Runs UTBot flip + pullback add-on (band 1%, maxAdds 3) and splits realised legs into:
 *   BASE  = the entry on each flip
 *   ADD   = the pullback scale-in legs (the "pullback" part the user wants isolated)
 * Reports, per config and per leg-kind: #trades, wins, losses, gross profit$, gross loss$,
 * fees$, net$ — FLAT $1000 per leg (no compounding) so columns add up: net = profit − loss − fees.
 *
 * Production gates the add-on to keyValue=4 → only BNBUSDT 4h runs it live. The other pairs are
 * shown as "if enabled" to illustrate why it is gated off there.
 *
 * Usage: ts-node --project apps/api/tsconfig.json scripts/run-pullback-addon-stats.ts [days] [feePctPerSide] [notional] [bandPct] [maxAdds]
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const ATR_PERIOD = 10;

const LIVE = [
  { symbol: 'BNBUSDT', interval: '4h', kv: 4, liveAddon: true },
  { symbol: 'ETHUSDT', interval: '4h', kv: 2, liveAddon: false },
  { symbol: 'BTCUSDT', interval: '1d', kv: 2, liveAddon: false },
  { symbol: 'SOLUSDT', interval: '1d', kv: 2, liveAddon: false },
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
const emptyAgg = (): Agg => ({ trades: 0, wins: 0, losses: 0, grossProfit: 0, grossLoss: 0, fees: 0 });
function addLeg(a: Agg, gross: number, fee: number) {
  a.trades++; a.fees += fee;
  if (gross >= 0) { a.wins++; a.grossProfit += gross; } else { a.losses++; a.grossLoss += -gross; }
}
const net = (a: Agg) => a.grossProfit - a.grossLoss - a.fees;

type Leg = { dir: 'long' | 'short'; entry: number; kind: 'base' | 'add' };

function run(candles: Candle[], kv: number, fee: number, notional: number, bandPct: number, maxAdds: number) {
  const stop = utBotStops(candles, ATR_PERIOD, kv);
  const f = fee / 100, band = bandPct / 100;
  const trendAt = (i: number) => (i < ATR_PERIOD || stop[i] === 0 ? null : candles[i]!.close > stop[i]! ? 'bull' : 'bear');
  const base = emptyAgg(), add = emptyAgg();

  let open: Leg[] = [], prev: 'bull' | 'bear' | null = null, addsThisTrend = 0, armed = false;
  const closeAll = (px: number) => {
    for (const leg of open) {
      const gross = (leg.dir === 'long' ? (px - leg.entry) / leg.entry : (leg.entry - px) / leg.entry) * notional;
      addLeg(leg.kind === 'base' ? base : add, gross, notional * f * 2); // open+close
    }
    open = [];
  };
  const openBase = (dir: 'long' | 'short', px: number) => { open = [{ dir, entry: px, kind: 'base' }]; addsThisTrend = 0; armed = false; };

  for (let i = ATR_PERIOD; i < candles.length; i++) {
    const t = trendAt(i); if (t === null) continue;
    const close = candles[i]!.close, line = stop[i]!;
    if (open.length === 0 && prev === null) { openBase(t === 'bull' ? 'long' : 'short', close); prev = t; continue; }
    if (t !== prev && open.length > 0) { closeAll(close); openBase(t === 'bull' ? 'long' : 'short', close); prev = t; continue; }
    if (open.length > 0) {
      const dist = Math.abs(close - line) / line;
      if (dist > band) armed = true;
      else if (armed && addsThisTrend < maxAdds) {
        open.push({ dir: prev === 'bull' ? 'long' : 'short', entry: close, kind: 'add' });
        addsThisTrend++; armed = false;
      }
    }
  }
  if (open.length > 0) {
    const last = candles[candles.length - 1]!.close;
    for (const leg of open) {
      const gross = (leg.dir === 'long' ? (last - leg.entry) / leg.entry : (leg.entry - last) / leg.entry) * notional;
      addLeg(leg.kind === 'base' ? base : add, gross, notional * f); // closing fee only (still open)
    }
  }
  return { base, add };
}

function printRow(label: string, a: Agg) {
  console.log(
    `  ${label.padEnd(26)} | ${String(a.trades).padStart(6)} | ${String(a.wins).padStart(4)} | ${String(a.losses).padStart(4)} | ` +
      `${('+$' + fmt(a.grossProfit)).padStart(11)} | ${('-$' + fmt(a.grossLoss)).padStart(11)} | ${('-$' + fmt(a.fees)).padStart(8)} | ${usd(net(a)).padStart(11)}`,
  );
}
const combine = (x: Agg, y: Agg): Agg => ({ trades: x.trades + y.trades, wins: x.wins + y.wins, losses: x.losses + y.losses, grossProfit: x.grossProfit + y.grossProfit, grossLoss: x.grossLoss + y.grossLoss, fees: x.fees + y.fees });

async function main() {
  const [, , daysArg, feeArg, notArg, bandArg, maxArg] = process.argv;
  const days = Number(daysArg ?? 365), fee = Number(feeArg ?? 0.05), notional = Number(notArg ?? 1000), band = Number(bandArg ?? 1), maxAdds = Number(maxArg ?? 3);
  const endMs = Date.now(), startMs = endMs - days * 864e5;

  console.log(`\n=== PULLBACK add-on isolated stats | ${days}d | $${notional}/leg FLAT | fee ${fee}%/side | band ${band}% | maxAdds ${maxAdds} ===`);
  console.log('(ADD = the pullback scale-in legs; BASE = the flip entry)\n');

  for (const cfg of LIVE) {
    const candles = await fetchKlines(cfg.symbol, cfg.interval, startMs, endMs);
    const { base, add } = run(candles, cfg.kv, fee, notional, band, maxAdds);
    console.log(`${cfg.symbol} ${cfg.interval} kv=${cfg.kv}  ${cfg.liveAddon ? '★ PULLBACK BẬT LIVE' : '(pullback hiện TẮT live — chỉ giả lập)'}`);
    console.log('  leg-kind                   | trades | win  | loss |   tổng lãi  |   tổng lỗ   |   phí    |    NET');
    printRow('BASE (flip entry)', base);
    printRow('ADD  (pullback scale-in)', add);
    printRow('→ COMBINED', combine(base, add));
    console.log('');
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
