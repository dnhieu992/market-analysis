/**
 * NEW exit rule: once a position is +beTp% in profit, move its stop-loss to entry (breakeven)
 * and let it keep running. The trade still exits on the UTBot flip; but if price retraces to
 * entry AFTER arming, the leg is closed at breakeven (≈$0, minus fees) instead of riding the flip.
 *
 * Applied to EVERY leg (base + pullback adds). Live config: pullback add-on only on kv=4 (BNB).
 *
 * CURRENT = ride to flip, no breakeven.  NEW = breakeven stop armed at +beTp%.
 * FLAT $notional/leg, no compounding: net = grossProfit − grossLoss − fees.
 * `be` = number of legs that were stopped out at breakeven.
 *
 * Modelling: a leg armed on candle i can only be BE-stopped on candle i+1 onward (arm-then-stop
 * ordering avoids same-candle whipsaw). +beTp% arming and the BE touch are checked intra-candle.
 *
 * Usage: ts-node --project apps/api/tsconfig.json scripts/run-breakeven-at-3pct-backtest.ts [days] [feePctPerSide] [notional] [beTpPct] [bandPct] [maxAdds]
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const ATR_PERIOD = 10;

const LIVE = [
  { symbol: 'ETHUSDT', interval: '4h', kv: 2 },
  { symbol: 'BTCUSDT', interval: '1d', kv: 2 },
  { symbol: 'BNBUSDT', interval: '4h', kv: 4 }, // pullback add-on live here
  { symbol: 'SOLUSDT', interval: '1d', kv: 2 },
];
const addonEnabled = (kv: number) => kv === 4;

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

type Agg = { trades: number; wins: number; losses: number; grossProfit: number; grossLoss: number; fees: number; be: number };
const emptyAgg = (): Agg => ({ trades: 0, wins: 0, losses: 0, grossProfit: 0, grossLoss: 0, fees: 0, be: 0 });
function book(a: Agg, gross: number, fee: number, wasBE = false) {
  a.trades++; a.fees += fee; if (wasBE) a.be++;
  if (gross >= 0) { a.wins++; a.grossProfit += gross; } else { a.losses++; a.grossLoss += -gross; }
}
const net = (a: Agg) => a.grossProfit - a.grossLoss - a.fees;

type Leg = { dir: 'long' | 'short'; entry: number; beArmed: boolean };

function run(candles: Candle[], kv: number, fee: number, notional: number, beTpPct: number, bandPct: number, maxAdds: number, useBE: boolean): Agg {
  const stop = utBotStops(candles, ATR_PERIOD, kv);
  const f = fee / 100, band = bandPct / 100, beTp = beTpPct / 100, addon = addonEnabled(kv);
  const trendAt = (i: number) => (i < ATR_PERIOD || stop[i] === 0 ? null : candles[i]!.close > stop[i]! ? 'bull' : 'bear');
  const agg = emptyAgg();

  let open: Leg[] = [], prev: 'bull' | 'bear' | null = null, addsThisTrend = 0, armed = false;
  const gross = (leg: Leg, px: number) => (leg.dir === 'long' ? (px - leg.entry) / leg.entry : (leg.entry - px) / leg.entry) * notional;
  const closeAll = (px: number) => { for (const leg of open) book(agg, gross(leg, px), notional * f * 2); open = []; };
  const openBase = (dir: 'long' | 'short', px: number) => { open = [{ dir, entry: px, beArmed: false }]; addsThisTrend = 0; armed = false; };

  for (let i = ATR_PERIOD; i < candles.length; i++) {
    const t = trendAt(i); if (t === null) continue;
    const c = candles[i]!, close = c.close, line = stop[i]!;
    if (prev === null) { openBase(t === 'bull' ? 'long' : 'short', close); prev = t; continue; }
    // Flip → close any open legs, ALWAYS reopen a fresh base (even if the book emptied via a BE stop)
    if (t !== prev) { if (open.length > 0) closeAll(close); openBase(t === 'bull' ? 'long' : 'short', close); prev = t; continue; }

    if (open.length > 0) {
      if (useBE) {
        const keep: Leg[] = [];
        for (const leg of open) {
          // 1) BE stop check (uses arming state from PRIOR candles)
          if (leg.beArmed) {
            const touched = leg.dir === 'long' ? c.low <= leg.entry : c.high >= leg.entry;
            if (touched) { book(agg, 0, notional * f * 2, true); continue; } // closed at breakeven
          }
          // 2) arm BE if +beTp% reached this candle
          if (!leg.beArmed) {
            const armPx = leg.dir === 'long' ? leg.entry * (1 + beTp) : leg.entry * (1 - beTp);
            const hit = leg.dir === 'long' ? c.high >= armPx : c.low <= armPx;
            if (hit) leg.beArmed = true;
          }
          keep.push(leg);
        }
        open = keep;
      }
      // pullback scale-in
      if (addon && open.length > 0) {
        const dist = Math.abs(close - line) / line;
        if (dist > band) armed = true;
        else if (armed && addsThisTrend < maxAdds) { open.push({ dir: prev === 'bull' ? 'long' : 'short', entry: close, beArmed: false }); addsThisTrend++; armed = false; }
      }
    }
  }
  if (open.length > 0) { const last = candles[candles.length - 1]!.close; for (const leg of open) book(agg, gross(leg, last), notional * f); }
  return agg;
}

function printRow(label: string, a: Agg) {
  console.log(
    `  ${label.padEnd(22)} | ${String(a.trades).padStart(6)} | ${String(a.wins).padStart(4)} | ${String(a.losses).padStart(4)} | ${String(a.be).padStart(3)} | ` +
      `${('+$' + fmt(a.grossProfit)).padStart(11)} | ${('-$' + fmt(a.grossLoss)).padStart(11)} | ${('-$' + fmt(a.fees)).padStart(7)} | ${usd(net(a)).padStart(11)}`,
  );
}
const combine = (x: Agg, y: Agg): Agg => ({ trades: x.trades + y.trades, wins: x.wins + y.wins, losses: x.losses + y.losses, grossProfit: x.grossProfit + y.grossProfit, grossLoss: x.grossLoss + y.grossLoss, fees: x.fees + y.fees, be: x.be + y.be });

async function main() {
  const [, , daysArg, feeArg, notArg, beArg, bandArg, maxArg] = process.argv;
  const days = Number(daysArg ?? 365), fee = Number(feeArg ?? 0.05), notional = Number(notArg ?? 1000), beTp = Number(beArg ?? 3), band = Number(bandArg ?? 1), maxAdds = Number(maxArg ?? 3);
  const endMs = Date.now(), startMs = endMs - days * 864e5;

  console.log(`\n=== NEW RULE: move SL to breakeven at +${beTp}% profit, then ride to flip | ${days}d | $${notional}/leg FLAT | fee ${fee}%/side ===`);
  console.log('(header: trades | win | loss | be=#breakeven stop-outs | tổng lãi | tổng lỗ | phí | NET)\n');
  let tc = emptyAgg(), tn = emptyAgg();
  for (const cfg of LIVE) {
    const candles = await fetchKlines(cfg.symbol, cfg.interval, startMs, endMs);
    const cur = run(candles, cfg.kv, fee, notional, beTp, band, maxAdds, false);
    const neo = run(candles, cfg.kv, fee, notional, beTp, band, maxAdds, true);
    console.log(`${cfg.symbol} ${cfg.interval} kv=${cfg.kv}${addonEnabled(cfg.kv) ? ' (pullback live)' : ''}`);
    console.log('  strategy               | trades | win  | loss | be  |   tổng lãi  |   tổng lỗ   |   phí   |    NET');
    printRow('CURRENT (ride flip)', cur);
    printRow(`NEW (BE at +${beTp}%)`, neo);
    console.log(`  → NET change: ${usd(net(neo) - net(cur))}\n`);
    tc = combine(tc, cur); tn = combine(tn, neo);
  }
  console.log('=== TOTAL (4 cặp live) ===');
  console.log('  strategy               | trades | win  | loss | be  |   tổng lãi  |   tổng lỗ   |   phí   |    NET');
  printRow('CURRENT (ride flip)', tc);
  printRow(`NEW (BE at +${beTp}%)`, tn);
  console.log(`  → NET change: ${usd(net(tn) - net(tc))}\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
