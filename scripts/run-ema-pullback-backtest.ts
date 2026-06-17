/**
 * Backtest a triple-EMA (34/89/200) PULLBACK strategy with an ATR trailing stop.
 *
 * Rule (decided with the user):
 *   LONG:
 *     - Stack aligned:  close > EMA34 > EMA89 > EMA200
 *     - Entry trigger:  candle pulls back to EMA34 (low <= EMA34) but does NOT
 *                       close below it (close stays > EMA34). Enter at that close.
 *     - Take profit:    ATR trailing stop (ratchets up, never down). Exit at the
 *                       stop level when a later candle's LOW <= stop.
 *     - Forced exit:    candle CLOSES below EMA34 -> exit at that close.
 *   SHORT: the mirror image (close < EMA34 < EMA89 < EMA200; high >= EMA34 entry;
 *          trailing stop ratchets down; forced exit when candle closes above EMA34).
 *
 * One position at a time, flat between setups. $1000 compounded, no leverage.
 * Fee charged on BOTH sides of every round-trip trade. Trailing-stop fills are
 * assumed at the stop price (crypto trades 24/7, intra-candle gaps ignored) —
 * real fills are slightly worse.
 *
 * Usage:
 *   ts-node --project apps/api/tsconfig.json scripts/run-ema-pullback-backtest.ts \
 *     [symbols] [interval] [days] [capital] [feePctPerSide] [emaPeriods] [atrMultList] [atrPeriod]
 *   e.g. ... BTCUSDT 4h 365 1000 0.05 "34,89,200" "2,3" 10
 *        ... "BTCUSDT,ETHUSDT,SOLUSDT" 4h 365 1000 0.05 "34,89,200" "3" 10
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

function wilderAtr(c: Candle[], period: number): number[] {
  const n = c.length;
  const tr = c.map((x, i) => (i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1]!.close), Math.abs(x.low - c[i - 1]!.close))));
  const atr = new Array(n).fill(NaN);
  if (n < period) return atr;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i]!;
  atr[period - 1] = sum / period;
  for (let i = period; i < n; i++) atr[i] = (atr[i - 1]! * (period - 1) + tr[i]!) / period;
  return atr;
}

function fmt(n: number, d = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

type Trade = {
  dir: 'long' | 'short';
  entry: number;
  exit: number;
  entryTime: Date;
  exitTime: Date;
  retPct: number;
  reason: 'trail' | 'ema34';
};

function runPullback(
  candles: Candle[],
  periods: [number, number, number],
  atrPeriod: number,
  atrMult: number,
  capital: number,
  feePerSide: number,
) {
  const closes = candles.map((c) => c.close);
  const [pf, pm, ps] = periods;
  const eF = ema(closes, pf);
  const eM = ema(closes, pm);
  const eS = ema(closes, ps);
  const atr = wilderAtr(candles, atrPeriod);
  const fee = feePerSide / 100;
  const warmup = Math.max(pf, pm, ps, atrPeriod);

  const trades: Trade[] = [];
  let equity = capital;
  let barsInMarket = 0;
  let pos: { dir: 'long' | 'short'; entry: number; entryTime: Date; stop: number } | null = null;

  const close = (dir: 'long' | 'short', entry: number, exit: number) =>
    (dir === 'long' ? (exit - entry) / entry : (entry - exit) / entry) - 2 * fee;

  for (let i = warmup; i < candles.length; i++) {
    const c = candles[i]!;
    const f = eF[i]!, m = eM[i]!, s = eS[i]!, a = atr[i]!;
    if (!isFinite(f) || !isFinite(m) || !isFinite(s) || !isFinite(a)) continue;

    if (pos === null) {
      // LONG pullback entry: bullish stack + wick taps EMA34 but close holds above it
      const longSetup = c.close > f && f > m && m > s && c.low <= f;
      // SHORT pullback entry: bearish stack + wick taps EMA34 but close holds below it
      const shortSetup = c.close < f && f < m && m < s && c.high >= f;
      if (longSetup) {
        pos = { dir: 'long', entry: c.close, entryTime: c.openTime, stop: c.close - atrMult * a };
      } else if (shortSetup) {
        pos = { dir: 'short', entry: c.close, entryTime: c.openTime, stop: c.close + atrMult * a };
      }
      continue;
    }

    barsInMarket++;

    if (pos.dir === 'long') {
      // 1) trailing stop hit intra-candle (use the level carried from prior bars)
      if (c.low <= pos.stop) {
        equity *= 1 + close('long', pos.entry, pos.stop);
        trades.push({ dir: 'long', entry: pos.entry, exit: pos.stop, entryTime: pos.entryTime, exitTime: c.openTime, retPct: close('long', pos.entry, pos.stop), reason: 'trail' });
        pos = null;
        continue;
      }
      // 2) forced exit: candle closes below EMA34
      if (c.close < f) {
        equity *= 1 + close('long', pos.entry, c.close);
        trades.push({ dir: 'long', entry: pos.entry, exit: c.close, entryTime: pos.entryTime, exitTime: c.openTime, retPct: close('long', pos.entry, c.close), reason: 'ema34' });
        pos = null;
        continue;
      }
      // 3) ratchet the trailing stop up
      pos.stop = Math.max(pos.stop, c.close - atrMult * a);
    } else {
      if (c.high >= pos.stop) {
        equity *= 1 + close('short', pos.entry, pos.stop);
        trades.push({ dir: 'short', entry: pos.entry, exit: pos.stop, entryTime: pos.entryTime, exitTime: c.openTime, retPct: close('short', pos.entry, pos.stop), reason: 'trail' });
        pos = null;
        continue;
      }
      if (c.close > f) {
        equity *= 1 + close('short', pos.entry, c.close);
        trades.push({ dir: 'short', entry: pos.entry, exit: c.close, entryTime: pos.entryTime, exitTime: c.openTime, retPct: close('short', pos.entry, c.close), reason: 'ema34' });
        pos = null;
        continue;
      }
      pos.stop = Math.min(pos.stop, c.close + atrMult * a);
    }
  }

  // Mark-to-market any final open position at the last close
  if (pos) {
    const last = candles[candles.length - 1]!.close;
    const r = close(pos.dir, pos.entry, last);
    equity *= 1 + r;
    trades.push({ dir: pos.dir, entry: pos.entry, exit: last, entryTime: pos.entryTime, exitTime: candles[candles.length - 1]!.openTime, retPct: r, reason: 'ema34' });
  }

  const wins = trades.filter((t) => t.retPct > 0).length;
  const trailExits = trades.filter((t) => t.reason === 'trail').length;
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
    trailExits,
    winRate: trades.length ? wins / trades.length : 0,
    finalEquity: equity,
    returnPct: (equity / capital - 1) * 100,
    maxDD: maxDD * 100,
    exposure: exposure * 100,
    list: trades,
  };
}

async function main() {
  const [, , symArg, intArg, daysArg, capArg, feeArg, emaArg, multArg, atrPArg] = process.argv;
  const symbols = (symArg ?? 'BTCUSDT').split(',').map((s) => s.trim().toUpperCase());
  const interval = intArg ?? '4h';
  const days = Number(daysArg ?? 365);
  const capital = Number(capArg ?? 1000);
  const feePerSide = Number(feeArg ?? 0.05); // user's real fee = 0.05%/side
  const periods = ((emaArg ?? '34,89,200').split(',').map(Number) as number[]).slice(0, 3) as [number, number, number];
  const mults = (multArg ?? '2,3').split(',').map(Number);
  const atrPeriod = Number(atrPArg ?? 10);

  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;

  // Fetch once per symbol, reuse across multipliers
  const dataBySymbol = new Map<string, Candle[]>();
  for (const symbol of symbols) {
    dataBySymbol.set(symbol, await fetchKlines(symbol, interval, startMs, endMs));
  }

  for (const mult of mults) {
    console.log(`\n=== EMA PULLBACK ${periods.join('/')} + ATR(${atrPeriod})x${mult} trail | ${interval} | ${days}d | $${capital} | fee ${feePerSide}%/side ===`);
    console.log('symbol     | trades | trail | winRate |   final$   | return% | maxDD% | expo%');
    const rows: { symbol: string; r: ReturnType<typeof runPullback> }[] = [];
    for (const symbol of symbols) {
      const candles = dataBySymbol.get(symbol)!;
      if (!candles || candles.length === 0) {
        console.log(`${symbol.padEnd(10)} | no data`);
        continue;
      }
      const r = runPullback(candles, periods, atrPeriod, mult, capital, feePerSide);
      rows.push({ symbol, r });
      console.log(
        `${symbol.padEnd(10)} | ${String(r.trades).padStart(6)} | ${String(r.trailExits).padStart(5)} | ${fmt(r.winRate * 100).padStart(6)}% | ${('$' + fmt(r.finalEquity)).padStart(10)} | ${((r.returnPct >= 0 ? '+' : '') + fmt(r.returnPct)).padStart(8)} | ${fmt(r.maxDD).padStart(6)} | ${fmt(r.exposure).padStart(5)}`
      );
    }
    const first = rows[0];
    if (mults.length === 1 && first && first.r.list.length) {
      console.log(`\n${first.symbol} last 8 trades:`);
      console.log('  entry time          dir    entry      exit       ret%   reason');
      for (const t of first.r.list.slice(-8)) {
        console.log(`  ${t.entryTime.toISOString().slice(0, 16).replace('T', ' ')}  ${t.dir.padEnd(5)}  ${fmt(t.entry).padStart(9)}  ${fmt(t.exit).padStart(9)}  ${((t.retPct * 100 >= 0 ? '+' : '') + fmt(t.retPct * 100)).padStart(6)}  ${t.reason}`);
      }
    }
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
