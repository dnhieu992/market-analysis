/**
 * Backtest the user's exact flow: UTBot trend stop-and-reverse on CANDLE CLOSE.
 *
 * Flow:
 *   - Compute UTBot trailing stop on CLOSED H4 candles.
 *   - trend = close > stop ? bull : bear.
 *   - On a confirmed flip (trend changes when a candle CLOSES): exit the current
 *     position at that candle's close AND immediately enter the opposite position
 *     at the same close (always in market).
 *   - $1000 starting capital, fully compounded, no leverage.
 *
 * Usage:
 *   ts-node --project apps/api/tsconfig.json scripts/run-flip-backtest.ts \
 *     [symbol] [interval] [days] [capital] [feePctPerSide] [kvList]
 *   e.g. ... BTCUSDT 4h 365 1000 0.04 "1,2,3"
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const ATR_PERIOD = 10;

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

function wilderAtr(c: Candle[], period: number): number[] {
  const n = c.length;
  const tr = c.map((x, i) => (i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1]!.close), Math.abs(x.low - c[i - 1]!.close))));
  const atr = new Array(n).fill(0);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i]!;
  atr[period - 1] = sum / period;
  for (let i = period; i < n; i++) atr[i] = (atr[i - 1]! * (period - 1) + tr[i]!) / period;
  return atr;
}

// Same UTBot stop formula as the strategy.
function utBotStops(c: Candle[], period: number, keyValue: number): number[] {
  const atr = wilderAtr(c, period);
  const stop = new Array(c.length).fill(0);
  for (let i = 1; i < c.length; i++) {
    const nLoss = keyValue * atr[i]!;
    const close = c[i]!.close;
    const prevC = c[i - 1]!.close;
    const prev = stop[i - 1]!;
    if (close > prev && prevC > prev) stop[i] = Math.max(prev, close - nLoss);
    else if (close < prev && prevC < prev) stop[i] = Math.min(prev, close + nLoss);
    else if (close > prev) stop[i] = close - nLoss;
    else stop[i] = close + nLoss;
  }
  return stop;
}

function fmt(n: number, d = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

type Trade = { dir: 'long' | 'short'; entry: number; exit: number; entryTime: Date; exitTime: Date; retPct: number };

function runFlip(candles: Candle[], keyValue: number, capital: number, feePerSide: number) {
  const stop = utBotStops(candles, ATR_PERIOD, keyValue);
  const fee = feePerSide / 100;

  // trend defined once ATR warmed up
  const trendAt = (i: number): 'bull' | 'bear' | null => {
    if (i < ATR_PERIOD || stop[i] === 0) return null;
    return candles[i]!.close > stop[i]! ? 'bull' : 'bear';
  };

  const trades: Trade[] = [];
  let equity = capital;
  let pos: { dir: 'long' | 'short'; entry: number; entryTime: Date } | null = null;
  let prevTrend: 'bull' | 'bear' | null = null;

  for (let i = ATR_PERIOD; i < candles.length; i++) {
    const t = trendAt(i);
    if (t === null) continue;
    const close = candles[i]!.close;

    // First entry: open in the direction of the first defined trend
    if (pos === null && prevTrend === null) {
      pos = { dir: t === 'bull' ? 'long' : 'short', entry: close, entryTime: candles[i]!.openTime };
      prevTrend = t;
      continue;
    }

    // Flip confirmed on this candle's close → exit + reverse
    if (t !== prevTrend && pos) {
      const gross = pos.dir === 'long' ? (close - pos.entry) / pos.entry : (pos.entry - close) / pos.entry;
      const net = gross - 2 * fee; // close old + open new = 2 sides charged at the flip
      equity *= 1 + net;
      trades.push({ dir: pos.dir, entry: pos.entry, exit: close, entryTime: pos.entryTime, exitTime: candles[i]!.openTime, retPct: net });
      // reverse
      pos = { dir: t === 'bull' ? 'long' : 'short', entry: close, entryTime: candles[i]!.openTime };
      prevTrend = t;
    }
  }

  // Close the final open position at the last close (mark-to-market)
  if (pos) {
    const last = candles[candles.length - 1]!.close;
    const gross = pos.dir === 'long' ? (last - pos.entry) / pos.entry : (pos.entry - last) / pos.entry;
    const net = gross - fee; // only closing side
    equity *= 1 + net;
    trades.push({ dir: pos.dir, entry: pos.entry, exit: last, entryTime: pos.entryTime, exitTime: candles[candles.length - 1]!.openTime, retPct: net });
  }

  const wins = trades.filter((t) => t.retPct > 0).length;
  // max drawdown on the compounding equity curve
  let eq = capital, peak = capital, maxDD = 0;
  for (const t of trades) {
    eq *= 1 + t.retPct;
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  return {
    keyValue,
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
  const [, , symArg, intArg, daysArg, capArg, feeArg, kvArg] = process.argv;
  const symbol = symArg ?? 'BTCUSDT';
  const interval = intArg ?? '4h';
  const days = Number(daysArg ?? 365);
  const capital = Number(capArg ?? 1000);
  const feePerSide = Number(feeArg ?? 0.04); // futures taker ≈ 0.04%/side; pass 0 for gross
  const kvList = (kvArg ?? '1,2,3').split(',').map(Number);

  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;
  console.log(`\nFetching ${symbol} ${interval} (${days}d)...`);
  const candles = await fetchKlines(symbol, interval, startMs, endMs);
  console.log(`${candles.length} candles  ${candles[0]?.openTime.toISOString().slice(0, 10)} → ${candles[candles.length - 1]?.openTime.toISOString().slice(0, 10)}`);

  console.log(`\n=== STOP-AND-REVERSE on CLOSE | ${symbol} ${interval} | ATR(${ATR_PERIOD}) | $${capital} compounding | fee ${feePerSide}%/side ===`);
  console.log('keyValue | trades | winRate |   final$   | return% | maxDD%');
  let best: ReturnType<typeof runFlip> | null = null;
  for (const kv of kvList) {
    const r = runFlip(candles, kv, capital, feePerSide);
    console.log(
      `   ${String(kv).padEnd(5)} | ${String(r.trades).padStart(6)} | ${fmt(r.winRate * 100).padStart(6)}% | ${('$' + fmt(r.finalEquity)).padStart(10)} | ${(r.returnPct >= 0 ? '+' : '') + fmt(r.returnPct)}%`.padEnd(60) + ` | ${fmt(r.maxDD)}%`
    );
    if (!best || r.finalEquity > best.finalEquity) best = r;
  }

  if (best) {
    console.log(`\nBest: keyValue=${best.keyValue} → $${fmt(best.finalEquity)} (${(best.returnPct >= 0 ? '+' : '') + fmt(best.returnPct)}%). Last 8 trades:`);
    console.log('  entry time          dir    entry      exit       ret%');
    for (const t of best.list.slice(-8)) {
      console.log(`  ${t.entryTime.toISOString().slice(0, 16).replace('T', ' ')}  ${t.dir.padEnd(5)}  ${fmt(t.entry).padStart(9)}  ${fmt(t.exit).padStart(9)}  ${(t.retPct * 100 >= 0 ? '+' : '') + fmt(t.retPct * 100)}%`);
    }
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
