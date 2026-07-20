/**
 * Backtest "Setup #2 — EMA pullback in trend, TAKE-PROFIT at prior swing high"
 * (long-only, high-win-rate / low-R:R mean-reversion). This is deliberately
 * different from run-ema-pullback-backtest.ts, which exits on an ATR TRAILING
 * STOP (a trend-rider, lower win-rate profile). This one suits a no-fixed-stop
 * trader: many small wins, exit-instead-of-SL on trend break.
 *
 * Rules (long only):
 *   - Trend filter: only hunt entries while close > EMA(trendPeriod, def 200).
 *   - Entry: a candle whose LOW <= EMA(pullPeriod) but that CLOSES back above it
 *     (a pullback that held) → enter at that candle's close, if flat.
 *   - Take-profit: nearest prior swing high = highest HIGH over the last
 *     `lookback` candles before entry. Exit at that price when a later candle's
 *     HIGH reaches it (limit fill assumed at target).
 *   - Exit-instead-of-SL: if a later candle CLOSES below EMA(trendPeriod) before
 *     TP is hit, exit at that close (thesis broken). This REPLACES a fixed SL.
 *   - One position at a time, $1000 compounding, no leverage, fee per side.
 *
 * Usage:
 *   ts-node --project apps/api/tsconfig.json scripts/run-ema-pullback-tp-backtest.ts \
 *     [symbol] [interval] [days] [capital] [feePctPerSide] [pullList] [lookback] [trendPeriod]
 *   e.g. ... BTCUSDT 1h 365 1000 0.05 "20,50" 20 200
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

// EMA seeded with an SMA of the first `period` closes.
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

type Trade = {
  entry: number;
  exit: number;
  entryTime: Date;
  exitTime: Date;
  retPct: number; // net of fees
  reason: 'tp' | 'trend-break' | 'eod';
};

function run(
  candles: Candle[],
  pullPeriod: number,
  lookback: number,
  trendPeriod: number,
  capital: number,
  feePerSide: number,
  exitOnBreak: boolean,
) {
  const closes = candles.map((c) => c.close);
  const emaPull = ema(closes, pullPeriod);
  const emaTrend = ema(closes, trendPeriod);
  const fee = feePerSide / 100;
  const warm = Math.max(pullPeriod, trendPeriod);

  const trades: Trade[] = [];
  let equity = capital;
  let barsInMarket = 0;
  let pos: { entry: number; entryTime: Date; target: number } | null = null;

  const net = (entry: number, exit: number) => (exit - entry) / entry - 2 * fee;

  for (let i = warm; i < candles.length; i++) {
    const c = candles[i]!;
    const p = emaPull[i]!;
    const s = emaTrend[i]!;
    if (!isFinite(p) || !isFinite(s)) continue;

    if (pos) {
      barsInMarket++;
      // 1) Take-profit if this candle trades up to the target.
      if (c.high >= pos.target) {
        const r = net(pos.entry, pos.target);
        equity *= 1 + r;
        trades.push({ entry: pos.entry, exit: pos.target, entryTime: pos.entryTime, exitTime: c.openTime, retPct: r, reason: 'tp' });
        pos = null;
      } else if (exitOnBreak && c.close < s) {
        // 2) Thesis broken (close below trend EMA) → exit at close.
        const r = net(pos.entry, c.close);
        equity *= 1 + r;
        trades.push({ entry: pos.entry, exit: c.close, entryTime: pos.entryTime, exitTime: c.openTime, retPct: r, reason: 'trend-break' });
        pos = null;
      }
      continue; // one position at a time
    }

    // Entry: uptrend + pullback that held above the pull-EMA.
    const up = c.close > s;
    const pulled = c.low <= p && c.close > p;
    if (up && pulled) {
      let hi = -Infinity;
      for (let j = Math.max(0, i - lookback); j < i; j++) hi = Math.max(hi, candles[j]!.high);
      if (hi > c.close) pos = { entry: c.close, entryTime: c.openTime, target: hi };
    }
  }

  // Mark-to-market any open position at the last close.
  if (pos) {
    const last = candles[candles.length - 1]!;
    const r = net(pos.entry, last.close);
    equity *= 1 + r;
    trades.push({ entry: pos.entry, exit: last.close, entryTime: pos.entryTime, exitTime: last.openTime, retPct: r, reason: 'eod' });
  }

  const wins = trades.filter((t) => t.retPct > 0);
  const losses = trades.filter((t) => t.retPct <= 0);
  const avgWin = wins.length ? wins.reduce((a, t) => a + t.retPct, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((a, t) => a + t.retPct, 0) / losses.length : 0;
  const grossWin = wins.reduce((a, t) => a + t.retPct, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.retPct, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : Infinity;

  let eq = capital, peak = capital, maxDD = 0;
  for (const t of trades) {
    eq *= 1 + t.retPct;
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  const exposure = candles.length > warm ? barsInMarket / (candles.length - warm) : 0;

  return {
    pullPeriod,
    trades: trades.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    avgWinPct: avgWin * 100,
    avgLossPct: avgLoss * 100,
    profitFactor,
    finalEquity: equity,
    returnPct: (equity / capital - 1) * 100,
    maxDD: maxDD * 100,
    breaks: trades.filter((t) => t.reason === 'trend-break').length,
    exposure: exposure * 100,
    list: trades,
  };
}

async function main() {
  const [, , symArg, intArg, daysArg, capArg, feeArg, pullArg, lookArg, trendArg, breakArg] = process.argv;
  const symbol = (symArg ?? 'BTCUSDT').toUpperCase();
  const interval = intArg ?? '1h';
  const days = Number(daysArg ?? 365);
  const capital = Number(capArg ?? 1000);
  const feePerSide = Number(feeArg ?? 0.05); // user's real fee = 0.05%/side
  const pullList = (pullArg ?? '20,50').split(',').map(Number);
  const lookback = Number(lookArg ?? 20);
  const trendPeriod = Number(trendArg ?? 200);
  const exitOnBreak = (breakArg ?? '1') !== '0'; // 0 = pure no-SL: hold until TP

  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;
  console.log(`\nFetching ${symbol} ${interval} (${days}d)...`);
  const candles = await fetchKlines(symbol, interval, startMs, endMs);
  console.log(`${candles.length} candles  ${candles[0]?.openTime.toISOString().slice(0, 10)} → ${candles[candles.length - 1]?.openTime.toISOString().slice(0, 10)}`);

  console.log(`\n=== EMA PULLBACK → TP@swingHigh (long-only) | ${symbol} ${interval} | trend>EMA${trendPeriod} | lookback ${lookback} | exitOnBreak=${exitOnBreak ? 'yes' : 'NO (hold til TP)'} | $${capital} compound | fee ${feePerSide}%/side ===`);
  console.log('pullEMA | trades | winRate | avgWin% | avgLoss% |  PF  | breaks |   final$   | return% | maxDD% | expo%');
  let best: ReturnType<typeof run> | null = null;
  for (const pp of pullList) {
    const r = run(candles, pp, lookback, trendPeriod, capital, feePerSide, exitOnBreak);
    console.log(
      `  EMA${String(pp).padEnd(3)} | ${String(r.trades).padStart(6)} | ${fmt(r.winRate * 100).padStart(6)}% | ${fmt(r.avgWinPct).padStart(6)}% | ${fmt(r.avgLossPct).padStart(7)}% | ${(r.profitFactor === Infinity ? '∞' : fmt(r.profitFactor)).padStart(4)} | ${String(r.breaks).padStart(6)} | ${('$' + fmt(r.finalEquity)).padStart(10)} | ${((r.returnPct >= 0 ? '+' : '') + fmt(r.returnPct)).padStart(8)} | ${fmt(r.maxDD).padStart(6)} | ${fmt(r.exposure).padStart(5)}`,
    );
    if (!best || r.finalEquity > best.finalEquity) best = r;
  }

  const bh = (candles[candles.length - 1]!.close / candles[0]!.close - 1) * 100;
  console.log(`\nBuy & hold ${symbol} same window: ${(bh >= 0 ? '+' : '') + fmt(bh)}%`);

  if (best) {
    console.log(`\nBest: pullEMA${best.pullPeriod} → $${fmt(best.finalEquity)} (${(best.returnPct >= 0 ? '+' : '') + fmt(best.returnPct)}%), winRate ${fmt(best.winRate * 100)}%. Last 8 trades:`);
    console.log('  entry time          entry      exit       ret%    reason');
    for (const t of best.list.slice(-8)) {
      console.log(`  ${t.entryTime.toISOString().slice(0, 16).replace('T', ' ')}  ${fmt(t.entry).padStart(9)}  ${fmt(t.exit).padStart(9)}  ${((t.retPct * 100 >= 0 ? '+' : '') + fmt(t.retPct * 100)).padStart(6)}   ${t.reason}`);
    }
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
