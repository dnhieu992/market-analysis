/**
 * Backtest the user's flow PLUS the pullback add-on rule.
 *
 * Base flow (unchanged): UTBot trend stop-and-reverse on CANDLE CLOSE, always in market.
 *   trend = close > stop ? bull : bear. On a confirmed flip, close everything and reverse.
 *
 * NEW pullback add-on rule (symmetric, both long & short):
 *   - While in a trend, if the candle CLOSE comes back to within `bandPct` (default 1%)
 *     of the UTBot stop line, open ONE MORE position in the trend direction (a scale-in):
 *       bull → add long, bear → add short.
 *   - Re-arm: an add can only fire again after price has moved MORE than `bandPct` away
 *     from the line and then returned inside it. Max `maxAdds` (default 3) per trend leg.
 *   - All positions (base + adds) close on the next confirmed flip, then reverse.
 *
 * Sizing: FLAT $100 per position (base and each add-on), no compounding. Results are
 * reported as total net PnL in $. We print BASELINE (flips only) vs WITH ADD-ON so the
 * marginal effect of the new rule is isolated.
 *
 * Usage:
 *   ts-node --project apps/api/tsconfig.json scripts/run-flip-pullback-backtest.ts \
 *     [symbol] [interval] [days] [feePctPerSide] [kvList] [bandPct] [maxAdds] [notional]
 *   e.g. ... BNBUSDT 4h 365 0.05 "1,2,3,4" 1 3 100
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

type Leg = { dir: 'long' | 'short'; entry: number; kind: 'base' | 'add' };

type Result = {
  keyValue: number;
  legs: number;
  adds: number;
  wins: number;
  winRate: number;
  netPnl: number;
  maxDD: number; // $ peak-to-trough on cumulative PnL
};

/**
 * @param useAddon  when false, runs the pure baseline (flips only) for comparison.
 */
function runFlip(
  candles: Candle[],
  keyValue: number,
  feePerSide: number,
  bandPct: number,
  maxAdds: number,
  notional: number,
  useAddon: boolean
): Result {
  const stop = utBotStops(candles, ATR_PERIOD, keyValue);
  const fee = feePerSide / 100;
  const band = bandPct / 100;

  const trendAt = (i: number): 'bull' | 'bear' | null => {
    if (i < ATR_PERIOD || stop[i] === 0) return null;
    return candles[i]!.close > stop[i]! ? 'bull' : 'bear';
  };

  // close one leg at price `exit`; charge round-trip fee on flat notional
  const closeLeg = (leg: Leg, exit: number): number => {
    const gross = leg.dir === 'long' ? (exit - leg.entry) / leg.entry : (leg.entry - exit) / leg.entry;
    return notional * gross - notional * fee * 2; // open + close = 2 sides
  };

  const pnls: number[] = []; // per-leg realised PnL, in order, for the equity/DD curve
  let openLegs: Leg[] = [];
  let prevTrend: 'bull' | 'bear' | null = null;
  let addsThisTrend = 0;
  let addsTotal = 0; // total add-on legs opened over the whole run
  let armed = false; // becomes true once price is > band away from the line

  const openBase = (dir: 'long' | 'short', entry: number) => {
    openLegs = [{ dir, entry, kind: 'base' }];
    addsThisTrend = 0;
    armed = false;
  };

  for (let i = ATR_PERIOD; i < candles.length; i++) {
    const t = trendAt(i);
    if (t === null) continue;
    const close = candles[i]!.close;
    const line = stop[i]!;

    // First entry
    if (openLegs.length === 0 && prevTrend === null) {
      openBase(t === 'bull' ? 'long' : 'short', close);
      prevTrend = t;
      continue;
    }

    // Confirmed flip → close ALL legs at this close, then reverse with a fresh base
    if (t !== prevTrend && openLegs.length > 0) {
      for (const leg of openLegs) pnls.push(closeLeg(leg, close));
      openBase(t === 'bull' ? 'long' : 'short', close);
      prevTrend = t;
      continue;
    }

    // Same trend → maybe fire a pullback add-on
    if (useAddon && openLegs.length > 0) {
      const distPct = Math.abs(close - line) / line; // distance from the stop line
      if (distPct > band) {
        armed = true; // price pushed away → re-arm
      } else if (armed && addsThisTrend < maxAdds) {
        const dir = prevTrend === 'bull' ? 'long' : 'short';
        openLegs.push({ dir, entry: close, kind: 'add' });
        addsThisTrend++;
        addsTotal++;
        armed = false; // must move away again before next add
      }
    }
  }

  // Mark-to-market any still-open legs at the last close (only closing-side fee)
  if (openLegs.length > 0) {
    const last = candles[candles.length - 1]!.close;
    for (const leg of openLegs) {
      const gross = leg.dir === 'long' ? (last - leg.entry) / leg.entry : (leg.entry - last) / leg.entry;
      pnls.push(notional * gross - notional * fee);
    }
  }

  const wins = pnls.filter((p) => p > 0).length;
  const netPnl = pnls.reduce((a, b) => a + b, 0);

  // cumulative PnL drawdown ($)
  let cum = 0, peak = 0, maxDD = 0;
  for (const p of pnls) {
    cum += p;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDD) maxDD = dd;
  }

  return {
    keyValue,
    legs: pnls.length,
    adds: addsTotal,
    wins,
    winRate: pnls.length ? wins / pnls.length : 0,
    netPnl,
    maxDD,
  };
}

async function main() {
  const [, , symArg, intArg, daysArg, feeArg, kvArg, bandArg, maxAddArg, notionalArg] = process.argv;
  const symbol = symArg ?? 'BTCUSDT';
  const interval = intArg ?? '4h';
  const days = Number(daysArg ?? 365);
  const feePerSide = Number(feeArg ?? 0.05);
  const kvList = (kvArg ?? '1,2,3,4').split(',').map(Number);
  const bandPct = Number(bandArg ?? 1);
  const maxAdds = Number(maxAddArg ?? 3);
  const notional = Number(notionalArg ?? 100);

  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;
  console.log(`\nFetching ${symbol} ${interval} (${days}d)...`);
  const candles = await fetchKlines(symbol, interval, startMs, endMs);
  console.log(`${candles.length} candles  ${candles[0]?.openTime.toISOString().slice(0, 10)} → ${candles[candles.length - 1]?.openTime.toISOString().slice(0, 10)}`);

  console.log(
    `\n=== FLIP + PULLBACK ADD-ON | ${symbol} ${interval} | ATR(${ATR_PERIOD}) | $${notional}/leg flat | fee ${feePerSide}%/side | band ${bandPct}% | maxAdds ${maxAdds} ===`
  );
  console.log('         |  BASELINE (flips only)   |        WITH ADD-ON                  |');
  console.log('keyValue | legs  winRate   netPnl$  | legs  winRate   netPnl$    maxDD$   |  Δ add-on$');
  for (const kv of kvList) {
    const base = runFlip(candles, kv, feePerSide, bandPct, maxAdds, notional, false);
    const add = runFlip(candles, kv, feePerSide, bandPct, maxAdds, notional, true);
    const delta = add.netPnl - base.netPnl;
    console.log(
      `   ${String(kv).padEnd(5)} |` +
        ` ${String(base.legs).padStart(4)}  ${fmt(base.winRate * 100).padStart(5)}%  ${('$' + fmt(base.netPnl)).padStart(9)} |` +
        ` ${String(add.legs).padStart(4)}  ${fmt(add.winRate * 100).padStart(5)}%  ${('$' + fmt(add.netPnl)).padStart(9)}  ${('$' + fmt(add.maxDD)).padStart(8)} |` +
        ` ${(delta >= 0 ? '+' : '') + fmt(delta)}`
    );
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
