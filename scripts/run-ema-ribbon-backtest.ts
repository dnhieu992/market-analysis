/**
 * Backtest a triple-EMA "ribbon" strategy (EMA 34 / 89 / 200) on candle CLOSE.
 *
 * Rule (ribbon alignment, decided with the user):
 *   - LONG  when EMA_fast > EMA_mid > EMA_slow  (bullish stack)
 *   - SHORT when EMA_fast < EMA_mid < EMA_slow  (bearish stack)
 *   - FLAT  otherwise (EMAs not stacked in order) — no position
 *   - State is read on each CLOSED candle. When the desired state changes,
 *     exit the current position (if any) at that close and enter the new one
 *     (if not FLAT) at the same close. Fee charged per side actually traded.
 *   - $1000 starting capital, fully compounded, no leverage.
 *
 * Unlike the UTBot flip flow this is NOT always-in-market: it sits flat while
 * the EMAs are tangled, which cuts whipsaw in chop at the cost of missing
 * the start of moves.
 *
 * Usage:
 *   ts-node --project apps/api/tsconfig.json scripts/run-ema-ribbon-backtest.ts \
 *     [symbols] [interval] [days] [capital] [feePctPerSide] [emaPeriods]
 *   e.g. ... BTCUSDT 4h 365 1000 0.05 "34,89,200"
 *        ... "BTCUSDT,ETHUSDT,SOLUSDT" 4h 365 1000 0.05 "34,89,200"
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

// Standard EMA seeded with an SMA of the first `period` closes.
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

type State = 'long' | 'short' | 'flat';
type Trade = { dir: 'long' | 'short'; entry: number; exit: number; entryTime: Date; exitTime: Date; retPct: number };

function runRibbon(candles: Candle[], periods: [number, number, number], capital: number, feePerSide: number) {
  const closes = candles.map((c) => c.close);
  const [pf, pm, ps] = periods;
  const eFast = ema(closes, pf);
  const eMid = ema(closes, pm);
  const eSlow = ema(closes, ps);
  const fee = feePerSide / 100;
  const warmup = Math.max(pf, pm, ps);

  const desiredAt = (i: number): State => {
    const f = eFast[i]!, m = eMid[i]!, s = eSlow[i]!;
    if (!isFinite(f) || !isFinite(m) || !isFinite(s)) return 'flat';
    if (f > m && m > s) return 'long';
    if (f < m && m < s) return 'short';
    return 'flat';
  };

  const trades: Trade[] = [];
  let equity = capital;
  let barsInMarket = 0;
  let pos: { dir: 'long' | 'short'; entry: number; entryTime: Date } | null = null;

  for (let i = warmup; i < candles.length; i++) {
    const want = desiredAt(i);
    const close = candles[i]!.close;
    const cur: State = pos ? pos.dir : 'flat';
    if (pos) barsInMarket++;
    if (want === cur) continue;

    // Close existing position (charge one side)
    if (pos) {
      const gross = pos.dir === 'long' ? (close - pos.entry) / pos.entry : (pos.entry - close) / pos.entry;
      const net = gross - fee;
      equity *= 1 + net;
      trades.push({ dir: pos.dir, entry: pos.entry, exit: close, entryTime: pos.entryTime, exitTime: candles[i]!.openTime, retPct: net });
      pos = null;
    }
    // Open new position if not flat (charge one side)
    if (want !== 'flat') {
      pos = { dir: want, entry: close, entryTime: candles[i]!.openTime };
    }
  }

  // Mark-to-market the final open position at the last close
  if (pos) {
    const last = candles[candles.length - 1]!.close;
    const gross = pos.dir === 'long' ? (last - pos.entry) / pos.entry : (pos.entry - last) / pos.entry;
    const net = gross - fee;
    equity *= 1 + net;
    trades.push({ dir: pos.dir, entry: pos.entry, exit: last, entryTime: pos.entryTime, exitTime: candles[candles.length - 1]!.openTime, retPct: net });
  }

  const wins = trades.filter((t) => t.retPct > 0).length;
  let eq = capital, peak = capital, maxDD = 0;
  for (const t of trades) {
    eq *= 1 + t.retPct;
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  const exposure = candles.length > warmup ? barsInMarket / (candles.length - warmup) : 0;

  return {
    trades: trades.length,
    wins,
    winRate: trades.length ? wins / trades.length : 0,
    finalEquity: equity,
    returnPct: (equity / capital - 1) * 100,
    maxDD: maxDD * 100,
    exposure: exposure * 100,
    list: trades,
  };
}

async function main() {
  const [, , symArg, intArg, daysArg, capArg, feeArg, emaArg] = process.argv;
  const symbols = (symArg ?? 'BTCUSDT').split(',').map((s) => s.trim().toUpperCase());
  const interval = intArg ?? '4h';
  const days = Number(daysArg ?? 365);
  const capital = Number(capArg ?? 1000);
  const feePerSide = Number(feeArg ?? 0.05); // user's real fee = 0.05%/side
  const periods = ((emaArg ?? '34,89,200').split(',').map(Number) as number[]).slice(0, 3) as [number, number, number];

  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;

  console.log(`\n=== EMA RIBBON ${periods.join('/')} on CLOSE | ${interval} | ${days}d | $${capital} compounding | fee ${feePerSide}%/side ===`);
  console.log('symbol     | trades | winRate |   final$   | return% | maxDD% | expo%');

  const results: { symbol: string; r: ReturnType<typeof runRibbon> }[] = [];
  for (const symbol of symbols) {
    const candles = await fetchKlines(symbol, interval, startMs, endMs);
    if (candles.length === 0) {
      console.log(`${symbol.padEnd(10)} | no data`);
      continue;
    }
    const r = runRibbon(candles, periods, capital, feePerSide);
    results.push({ symbol, r });
    console.log(
      `${symbol.padEnd(10)} | ${String(r.trades).padStart(6)} | ${fmt(r.winRate * 100).padStart(6)}% | ${('$' + fmt(r.finalEquity)).padStart(10)} | ${((r.returnPct >= 0 ? '+' : '') + fmt(r.returnPct)).padStart(8)} | ${fmt(r.maxDD).padStart(6)} | ${fmt(r.exposure).padStart(5)}`
    );
  }

  // Show last 8 trades for the first symbol as a sanity check
  const first = results[0];
  if (first && first.r.list.length) {
    console.log(`\n${first.symbol} last 8 trades:`);
    console.log('  entry time          dir    entry      exit       ret%');
    for (const t of first.r.list.slice(-8)) {
      console.log(`  ${t.entryTime.toISOString().slice(0, 16).replace('T', ' ')}  ${t.dir.padEnd(5)}  ${fmt(t.entry).padStart(9)}  ${fmt(t.exit).padStart(9)}  ${(t.retPct * 100 >= 0 ? '+' : '') + fmt(t.retPct * 100)}%`);
    }
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
