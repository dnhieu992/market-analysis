/**
 * Backtest an EMA RIBBON PULLBACK scalp (trend-following pullback entries).
 *
 * Rules:
 *   - Ribbon = EMA fast / mid / slow. Trend is "up" when fast>mid>slow, "down" when fast<mid<slow.
 *   - PULLBACK ARM: while trend is up, wait until a candle's LOW dips to/through EMA fast
 *     (price pulls back into the ribbon). Symmetric for downtrend (HIGH reaches EMA fast).
 *   - ENTRY (resumption): after armed, enter when a candle CLOSES back across EMA fast in the
 *     trend direction with a confirming body (close>open for long, close<open for short).
 *       LONG  entry = that close, in an uptrend.
 *       SHORT entry = that close, in a downtrend.
 *   - RISK: SL = the pullback extreme (lowest low / highest high seen while armed) ± buffer.
 *           risk% = |entry - SL| / entry ; TP = entry ± rr * risk.  (rr = reward:risk)
 *           SL/TP checked intra-candle (SL assumed first if both in same candle's range).
 *   - Trend flipping against the position also closes it.
 *   - One position at a time, $capital compounded, no leverage. Fee per side both ways.
 *
 * Usage:
 *   ts-node --project apps/api/tsconfig.json scripts/run-ema-ribbon-pullback-scalp.ts \
 *     [symbol] [interval] [days] [capital] [feePctPerSide] [emaPeriods] [rr] [slBufferPct] [maxRiskPct]
 *   e.g. ... BTCUSDT 5m 90 1000 0.05 "9,21,55" 1.5 0.05 1.5
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;

type Candle = { open: number; high: number; low: number; close: number; openTime: Date };

function fetchJson(url: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

async function fetchKlines(symbol: string, interval: string, startMs: number, endMs: number): Promise<Candle[]> {
  const candles: Candle[] = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const url = `${BINANCE_HOST}?symbol=${symbol}&interval=${interval}&startTime=${cursor}&endTime=${endMs}&limit=${MAX_PER_REQ}`;
    const batch = (await fetchJson(url)) as unknown[][];
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const k of batch) {
      candles.push({
        open: parseFloat(k[1] as string),
        high: parseFloat(k[2] as string),
        low: parseFloat(k[3] as string),
        close: parseFloat(k[4] as string),
        openTime: new Date(k[0] as number),
      });
    }
    if (batch.length < MAX_PER_REQ) break;
    cursor = (batch[batch.length - 1]![0] as number) + 1;
  }
  return candles;
}

function ema(values: number[], period: number): number[] {
  const out = new Array(values.length).fill(NaN);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i]!;
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function fmt(n: number, d = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

type Trade = { dir: 'long' | 'short'; entry: number; exit: number; entryTime: Date; exitTime: Date; reason: 'tp' | 'sl' | 'flip' | 'eod'; retPct: number };

function runPullbackScalp(
  candles: Candle[],
  periods: [number, number, number],
  capital: number,
  feePerSide: number,
  rr: number,
  slBufferPct: number,
  maxRiskPct: number,
) {
  const closes = candles.map((c) => c.close);
  const [pf, pm, ps] = periods;
  const eFast = ema(closes, pf);
  const eMid = ema(closes, pm);
  const eSlow = ema(closes, ps);
  const fee = feePerSide / 100;
  const buf = slBufferPct / 100;
  const maxRisk = maxRiskPct / 100;
  const warmup = Math.max(pf, pm, ps);

  const trendAt = (i: number): 'up' | 'down' | 'none' => {
    const f = eFast[i]!, m = eMid[i]!, s = eSlow[i]!;
    if (!isFinite(f) || !isFinite(m) || !isFinite(s)) return 'none';
    if (f > m && m > s) return 'up';
    if (f < m && m < s) return 'down';
    return 'none';
  };

  const trades: Trade[] = [];
  let equity = capital;
  let pos: { dir: 'long' | 'short'; entry: number; entryTime: Date; slPrice: number; tpPrice: number } | null = null;

  // pullback arm state
  let armed: 'up' | 'down' | null = null;
  let armExtreme = 0; // lowest low (up) / highest high (down) seen while armed

  const closeTrade = (exit: number, exitTime: Date, reason: Trade['reason']) => {
    const gross = pos!.dir === 'long' ? (exit - pos!.entry) / pos!.entry : (pos!.entry - exit) / pos!.entry;
    const net = gross - 2 * fee;
    equity *= 1 + net;
    trades.push({ dir: pos!.dir, entry: pos!.entry, exit, entryTime: pos!.entryTime, exitTime, reason, retPct: net });
    pos = null;
  };

  for (let i = warmup; i < candles.length; i++) {
    const c = candles[i]!;
    const tr = trendAt(i);
    const f = eFast[i]!;

    // 1. Manage open position first.
    if (pos) {
      if (pos.dir === 'long') {
        if (c.low <= pos.slPrice) closeTrade(pos.slPrice, c.openTime, 'sl');
        else if (c.high >= pos.tpPrice) closeTrade(pos.tpPrice, c.openTime, 'tp');
        else if (tr === 'down') closeTrade(c.close, c.openTime, 'flip');
      } else {
        if (c.high >= pos.slPrice) closeTrade(pos.slPrice, c.openTime, 'sl');
        else if (c.low <= pos.tpPrice) closeTrade(pos.tpPrice, c.openTime, 'tp');
        else if (tr === 'up') closeTrade(c.close, c.openTime, 'flip');
      }
    }
    if (pos) continue; // stay until exit; no pyramiding

    // 2. Pullback arming / entry logic (only when flat).
    if (tr === 'none') {
      armed = null;
      continue;
    }

    // reset arm if trend direction changed
    if (armed && armed !== tr) armed = null;

    if (tr === 'up') {
      // arm when price dips to/through fast EMA
      if (c.low <= f) {
        if (armed !== 'up') {
          armed = 'up';
          armExtreme = c.low;
        } else {
          armExtreme = Math.min(armExtreme, c.low);
        }
      }
      // entry: armed + bullish confirm close back above fast EMA
      if (armed === 'up' && c.close > f && c.close > c.open) {
        const entry = c.close;
        const sl = armExtreme * (1 - buf);
        let risk = (entry - sl) / entry;
        if (risk > 0 && risk <= maxRisk) {
          pos = { dir: 'long', entry, entryTime: c.openTime, slPrice: sl, tpPrice: entry * (1 + rr * risk) };
        }
        armed = null;
      }
    } else {
      // downtrend
      if (c.high >= f) {
        if (armed !== 'down') {
          armed = 'down';
          armExtreme = c.high;
        } else {
          armExtreme = Math.max(armExtreme, c.high);
        }
      }
      if (armed === 'down' && c.close < f && c.close < c.open) {
        const entry = c.close;
        const sl = armExtreme * (1 + buf);
        let risk = (sl - entry) / entry;
        if (risk > 0 && risk <= maxRisk) {
          pos = { dir: 'short', entry, entryTime: c.openTime, slPrice: sl, tpPrice: entry * (1 - rr * risk) };
        }
        armed = null;
      }
    }
  }

  if (pos) closeTrade(candles[candles.length - 1]!.close, candles[candles.length - 1]!.openTime, 'eod');

  const wins = trades.filter((t) => t.retPct > 0).length;
  let eq = capital, peak = capital, maxDD = 0;
  for (const t of trades) {
    eq *= 1 + t.retPct;
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  return {
    trades: trades.length,
    wins,
    winRate: trades.length ? wins / trades.length : 0,
    finalEquity: equity,
    returnPct: (equity / capital - 1) * 100,
    maxDD: maxDD * 100,
    list: trades,
  };
}

async function main() {
  const [, , symArg, intArg, daysArg, capArg, feeArg, emaArg, rrArg, bufArg, maxRiskArg] = process.argv;
  const symbol = (symArg ?? 'BTCUSDT').toUpperCase();
  const interval = intArg ?? '5m';
  const days = Number(daysArg ?? 90);
  const capital = Number(capArg ?? 1000);
  const feePerSide = Number(feeArg ?? 0.05);
  const periods = ((emaArg ?? '9,21,55').split(',').map(Number) as number[]).slice(0, 3) as [number, number, number];
  const rrList = (rrArg ?? '1.5').split(',').map(Number);
  const slBufferPct = Number(bufArg ?? 0.05);
  const maxRiskPct = Number(maxRiskArg ?? 1.5);

  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;
  console.log(`\nFetching ${symbol} ${interval} (${days}d)...`);
  const candles = await fetchKlines(symbol, interval, startMs, endMs);
  console.log(`${candles.length} candles  ${candles[0]?.openTime.toISOString().slice(0, 10)} → ${candles[candles.length - 1]?.openTime.toISOString().slice(0, 10)}`);

  console.log(`\n=== EMA RIBBON PULLBACK SCALP ${periods.join('/')} | ${symbol} ${interval} | ${days}d | $${capital} compounding | fee ${feePerSide}%/side`);
  console.log(`    SL=pullback extreme (buf ${slBufferPct}%, max risk ${maxRiskPct}%)  TP=rr×risk ===`);
  console.log('  rr  | trades | winRate |   final$   | return% | maxDD% | TP/SL/flip');
  let best: { rr: number; r: ReturnType<typeof runPullbackScalp> } | null = null;
  for (const rr of rrList) {
    const r = runPullbackScalp(candles, periods, capital, feePerSide, rr, slBufferPct, maxRiskPct);
    const byReason = (rs: Trade['reason']) => r.list.filter((t) => t.reason === rs).length;
    console.log(
      `  ${fmt(rr, 1)} | ${String(r.trades).padStart(6)} | ${fmt(r.winRate * 100).padStart(6)}% | ${('$' + fmt(r.finalEquity)).padStart(10)} | ${((r.returnPct >= 0 ? '+' : '') + fmt(r.returnPct)).padStart(8)} | ${fmt(r.maxDD).padStart(6)} | ${byReason('tp')}/${byReason('sl')}/${byReason('flip')}`
    );
    if (!best || r.finalEquity > best.r.finalEquity) best = { rr, r };
  }

  if (best && best.r.list.length) {
    console.log(`\nBest rr=${fmt(best.rr, 1)} → $${fmt(best.r.finalEquity)} (${(best.r.returnPct >= 0 ? '+' : '') + fmt(best.r.returnPct)}%). Last 8 trades:`);
    console.log('  entry time          dir    entry      exit       reason  ret%');
    for (const t of best.r.list.slice(-8)) {
      console.log(`  ${t.entryTime.toISOString().slice(0, 16).replace('T', ' ')}  ${t.dir.padEnd(5)}  ${fmt(t.entry).padStart(9)}  ${fmt(t.exit).padStart(9)}  ${t.reason.padEnd(6)}  ${(t.retPct * 100 >= 0 ? '+' : '') + fmt(t.retPct * 100)}%`);
    }
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
