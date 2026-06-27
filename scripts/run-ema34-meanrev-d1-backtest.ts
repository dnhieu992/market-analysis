/**
 * Backtest a D1 EMA34 MEAN-REVERSION (dip-buy) strategy.
 *
 * Rule (decided with the user):
 *   LONG only:
 *     - Entry trigger: a DAILY candle CLOSES at least `devPct`% BELOW EMA34
 *                      i.e. (EMA34 - close) / EMA34 >= devPct. Enter at that close.
 *                      One position at a time; flat between setups.
 *     - Take profit:   a later candle's HIGH touches EMA34 again (high >= EMA34).
 *                      Exit at the EMA34 level on that bar ("chốt khi chạm lại EMA34").
 *     - Stop loss:     fixed 10% below entry. If a later candle's LOW <= entry*0.90,
 *                      exit at the stop. (Checked BEFORE TP within a bar = worst case.)
 *     - Final open position is marked-to-market at the last close.
 *
 * We SWEEP `devPct` over a list (default 5,6,7,8,9,10) to find the optimal "how far
 * below EMA34 before buying" zone. $1000 compounded, no leverage. Fee on BOTH sides.
 * Intra-candle fills assumed at the trigger price (crypto trades 24/7) — real fills
 * are slightly worse; results exclude slippage and funding.
 *
 * Usage:
 *   ts-node --project apps/api/tsconfig.json scripts/run-ema34-meanrev-d1-backtest.ts \
 *     [symbols] [interval] [days] [capital] [feePctPerSide] [emaPeriod] [devPctList] [slPct]
 *   e.g. ... "POLUSDT,XRPUSDT,SOLUSDT,TAOUSDT" 1d 2200 1000 0.05 34 "5,6,7,8,9,10" 10
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
  retPct: number;
  barsHeld: number;
  reason: 'tp' | 'sl' | 'eod';
};

function runMeanRev(
  candles: Candle[],
  emaPeriod: number,
  devPct: number,
  slPct: number,
  capital: number,
  feePerSide: number,
) {
  const closes = candles.map((c) => c.close);
  const e = ema(closes, emaPeriod);
  const fee = feePerSide / 100;
  const dev = devPct / 100;
  const slFrac = slPct / 100;
  const warmup = emaPeriod;

  const ret = (entry: number, exit: number) => (exit - entry) / entry - 2 * fee; // long

  const trades: Trade[] = [];
  let equity = capital;
  let barsInMarket = 0;
  let pos: { entry: number; entryTime: Date; entryIdx: number; stop: number } | null = null;

  for (let i = warmup; i < candles.length; i++) {
    const c = candles[i]!;
    const em = e[i]!;
    if (!isFinite(em)) continue;

    if (pos === null) {
      // Entry: daily close at least devPct below EMA34.
      if (em > 0 && (em - c.close) / em >= dev) {
        pos = { entry: c.close, entryTime: c.openTime, entryIdx: i, stop: c.close * (1 - slFrac) };
      }
      continue;
    }

    barsInMarket++;
    // 1) Stop loss first (worst case within the bar).
    if (c.low <= pos.stop) {
      const r = ret(pos.entry, pos.stop);
      equity *= 1 + r;
      trades.push({ entry: pos.entry, exit: pos.stop, entryTime: pos.entryTime, exitTime: c.openTime, retPct: r, barsHeld: i - pos.entryIdx, reason: 'sl' });
      pos = null;
      continue;
    }
    // 2) Take profit: price touches EMA34 again.
    if (c.high >= em) {
      const r = ret(pos.entry, em);
      equity *= 1 + r;
      trades.push({ entry: pos.entry, exit: em, entryTime: pos.entryTime, exitTime: c.openTime, retPct: r, barsHeld: i - pos.entryIdx, reason: 'tp' });
      pos = null;
      continue;
    }
  }

  // Mark-to-market any final open position at the last close.
  if (pos) {
    const last = candles[candles.length - 1]!;
    const r = ret(pos.entry, last.close);
    equity *= 1 + r;
    trades.push({ entry: pos.entry, exit: last.close, entryTime: pos.entryTime, exitTime: last.openTime, retPct: r, barsHeld: candles.length - 1 - pos.entryIdx, reason: 'eod' });
  }

  const wins = trades.filter((t) => t.retPct > 0).length;
  const tps = trades.filter((t) => t.reason === 'tp').length;
  const sls = trades.filter((t) => t.reason === 'sl').length;
  const avgBars = trades.length ? trades.reduce((s, t) => s + t.barsHeld, 0) / trades.length : 0;
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
    tps,
    sls,
    winRate: trades.length ? wins / trades.length : 0,
    finalEquity: equity,
    returnPct: (equity / capital - 1) * 100,
    maxDD: maxDD * 100,
    exposure: exposure * 100,
    avgBars,
    list: trades,
  };
}

async function main() {
  const [, , symArg, intArg, daysArg, capArg, feeArg, emaArg, devArg, slArg] = process.argv;
  const symbols = (symArg ?? 'POLUSDT,XRPUSDT,SOLUSDT,TAOUSDT').split(',').map((s) => s.trim().toUpperCase());
  const interval = intArg ?? '1d';
  const days = Number(daysArg ?? 2200);
  const capital = Number(capArg ?? 1000);
  const feePerSide = Number(feeArg ?? 0.05); // user's real fee = 0.05%/side
  const emaPeriod = Number(emaArg ?? 34);
  const devs = (devArg ?? '5,6,7,8,9,10').split(',').map(Number);
  const slPct = Number(slArg ?? 10);

  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;

  // Fetch once per symbol, reuse across deviation thresholds.
  const dataBySymbol = new Map<string, Candle[]>();
  for (const symbol of symbols) {
    const c = await fetchKlines(symbol, interval, startMs, endMs);
    dataBySymbol.set(symbol, c);
    const span = c.length ? `${c[0]!.openTime.toISOString().slice(0, 10)} → ${c[c.length - 1]!.openTime.toISOString().slice(0, 10)}` : 'no data';
    console.log(`data ${symbol.padEnd(10)} ${String(c.length).padStart(5)} candles  (${span})`);
  }

  for (const dev of devs) {
    console.log(`\n=== EMA${emaPeriod} mean-rev LONG | entry <= -${dev}% vs EMA | TP=touch EMA | SL=${slPct}% | ${interval} | ${days}d | $${capital} | fee ${feePerSide}%/side ===`);
    console.log('symbol     | trades | TP | SL | winRate |   final$   | return% | maxDD% | avgBars | expo%');
    for (const symbol of symbols) {
      const candles = dataBySymbol.get(symbol)!;
      if (!candles || candles.length === 0) {
        console.log(`${symbol.padEnd(10)} | no data`);
        continue;
      }
      const r = runMeanRev(candles, emaPeriod, dev, slPct, capital, feePerSide);
      console.log(
        `${symbol.padEnd(10)} | ${String(r.trades).padStart(6)} | ${String(r.tps).padStart(2)} | ${String(r.sls).padStart(2)} | ${fmt(r.winRate * 100).padStart(6)}% | ${('$' + fmt(r.finalEquity)).padStart(10)} | ${((r.returnPct >= 0 ? '+' : '') + fmt(r.returnPct)).padStart(8)} | ${fmt(r.maxDD).padStart(6)} | ${fmt(r.avgBars, 1).padStart(7)} | ${fmt(r.exposure).padStart(5)}`,
      );
    }
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
