/**
 * Backtest the NEW swing method vs the baseline flip, side by side.
 *
 * Baseline (flip): UTBot trend stop-and-reverse on candle CLOSE, always in market,
 *   no fixed TP. (Same as scripts/run-flip-backtest.ts.)
 *
 * New method (partial + breakeven), mirroring the deployed worker logic:
 *   - Enter on the UTBot trend (first entry / on every flip), same as baseline.
 *   - PARTIAL: once price runs +PARTIAL_TP_PCT (default 5%) from entry, close HALF the
 *     position (filled at the +5% level, intra-candle) and ratchet SL to breakeven (entry).
 *   - RUNNER: the remaining half rides the UTBot trail and exits on the trend flip (close),
 *     OR at breakeven (entry) if price trades back to entry after the partial (intra-candle).
 *   - RE-ENTRY: a breakeven stop-out leaves the book flat; if the trend still holds, re-enter
 *     in the same direction on the next candle close (trend continuation), fresh partial state.
 *
 * Assumptions / honesty:
 *   - Trend flip is CLOSE-based (the UTBot signal). Partial TP and breakeven stop fill
 *     INTRA-candle at their price levels (limit/stop orders), which is the realistic read of
 *     the rule. The deployed worker only acts on candle close, so live fills are slightly later
 *     — treat these numbers as the optimistic edge of the rule.
 *   - Fees: open(full) + partial-close(half) + final-close(half) = 2×feePerSide per trade,
 *     same convention as the baseline. A breakeven stop-out + re-entry pays an extra round-trip.
 *   - No leverage, no funding, no slippage. Capital compounded.
 *
 * Usage:
 *   ts-node --project apps/api/tsconfig.json scripts/run-flip-partial-backtest.ts \
 *     [symbol] [interval] [days] [capital] [feePctPerSide] [kvList] [tpPct]
 *   e.g. ... BTCUSDT 30m 365 1000 0.05 "2,3,4,5,6" 5
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const ATR_PERIOD = 10;
const PARTIAL_FRACTION = 0.5;

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

type Result = {
  keyValue: number;
  trades: number;
  wins: number;
  winRate: number;
  finalEquity: number;
  returnPct: number;
  maxDD: number;
  partials?: number;
  breakevens?: number;
};

function metrics(keyValue: number, rets: number[], capital: number, extra: { partials: number; breakevens: number }): Result {
  const wins = rets.filter((r) => r > 0).length;
  let eq = capital, peak = capital, maxDD = 0, equity = capital;
  for (const r of rets) {
    eq *= 1 + r;
    equity = eq;
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return {
    keyValue,
    trades: rets.length,
    wins,
    winRate: rets.length ? wins / rets.length : 0,
    finalEquity: equity,
    returnPct: (equity / capital - 1) * 100,
    maxDD: maxDD * 100,
    ...extra,
  };
}

/** Baseline: pure stop-and-reverse on close, no TP. */
function runFlip(candles: Candle[], keyValue: number, capital: number, feePerSide: number): Result {
  const stop = utBotStops(candles, ATR_PERIOD, keyValue);
  const fee = feePerSide / 100;
  const trendAt = (i: number): 'bull' | 'bear' | null => {
    if (i < ATR_PERIOD || stop[i] === 0) return null;
    return candles[i]!.close > stop[i]! ? 'bull' : 'bear';
  };
  const rets: number[] = [];
  let pos: { dir: 'long' | 'short'; entry: number } | null = null;
  let prevTrend: 'bull' | 'bear' | null = null;

  for (let i = ATR_PERIOD; i < candles.length; i++) {
    const t = trendAt(i);
    if (t === null) continue;
    const close = candles[i]!.close;
    if (pos === null && prevTrend === null) {
      pos = { dir: t === 'bull' ? 'long' : 'short', entry: close };
      prevTrend = t;
      continue;
    }
    if (t !== prevTrend && pos) {
      const gross = pos.dir === 'long' ? (close - pos.entry) / pos.entry : (pos.entry - close) / pos.entry;
      rets.push(gross - 2 * fee);
      pos = { dir: t === 'bull' ? 'long' : 'short', entry: close };
      prevTrend = t;
    }
  }
  if (pos) {
    const last = candles[candles.length - 1]!.close;
    const gross = pos.dir === 'long' ? (last - pos.entry) / pos.entry : (pos.entry - last) / pos.entry;
    rets.push(gross - fee);
  }
  return metrics(keyValue, rets, capital, { partials: 0, breakevens: 0 });
}

/** New method: +tpPct partial (half) + breakeven SL, runner rides the flip. */
function runFlipPartial(candles: Candle[], keyValue: number, capital: number, feePerSide: number, tpPct: number): Result {
  const stop = utBotStops(candles, ATR_PERIOD, keyValue);
  const fee = feePerSide / 100;
  const TP = tpPct / 100;
  const trendAt = (i: number): 'bull' | 'bear' | null => {
    if (i < ATR_PERIOD || stop[i] === 0) return null;
    return candles[i]!.close > stop[i]! ? 'bull' : 'bear';
  };

  const rets: number[] = [];
  let partials = 0;
  let breakevens = 0;
  let pos: { dir: 'long' | 'short'; entry: number; partialDone: boolean } | null = null;
  let prevTrend: 'bull' | 'bear' | null = null;

  // Close the current position: combine the banked partial half + the remainder.
  const close = (p: NonNullable<typeof pos>, exitPrice: number) => {
    const remFrac = p.partialDone ? 1 - PARTIAL_FRACTION : 1;
    const grossRem = p.dir === 'long' ? (exitPrice - p.entry) / p.entry : (p.entry - exitPrice) / p.entry;
    const grossPartial = p.partialDone ? PARTIAL_FRACTION * TP : 0; // +TP on the half
    const net = grossPartial + remFrac * grossRem - 2 * fee;
    rets.push(net);
  };

  for (let i = ATR_PERIOD; i < candles.length; i++) {
    const t = trendAt(i);
    if (t === null) continue;
    const c = candles[i]!;

    // Open if flat (first entry, or re-entry after a breakeven stop while trend persists).
    if (pos === null) {
      pos = { dir: t === 'bull' ? 'long' : 'short', entry: c.close, partialDone: false };
      prevTrend = t;
      continue;
    }

    const tpPrice = pos.dir === 'long' ? pos.entry * (1 + TP) : pos.entry * (1 - TP);

    // A. Breakeven stop on the runner (only after a partial taken on a PRIOR candle).
    if (pos.partialDone) {
      const beHit = pos.dir === 'long' ? c.low <= pos.entry : c.high >= pos.entry;
      if (beHit) {
        close(pos, pos.entry); // remainder out at breakeven (~0 on the half)
        breakevens++;
        pos = null; // flat; re-enter next candle if trend still holds (prevTrend unchanged)
        continue;
      }
    }

    // B. Partial take-profit, filled intra-candle at the +TP level.
    if (!pos.partialDone) {
      const tpHit = pos.dir === 'long' ? c.high >= tpPrice : c.low <= tpPrice;
      if (tpHit) {
        pos.partialDone = true;
        partials++;
      }
    }

    // C. Trend flip on close → exit remainder at close and reverse.
    if (t !== prevTrend) {
      close(pos, c.close);
      pos = { dir: t === 'bull' ? 'long' : 'short', entry: c.close, partialDone: false };
      prevTrend = t;
    }
  }

  if (pos) close(pos, candles[candles.length - 1]!.close);
  return metrics(keyValue, rets, capital, { partials, breakevens });
}

async function main() {
  const [, , symArg, intArg, daysArg, capArg, feeArg, kvArg, tpArg] = process.argv;
  const symbol = symArg ?? 'BTCUSDT';
  const interval = intArg ?? '30m';
  const days = Number(daysArg ?? 365);
  const capital = Number(capArg ?? 1000);
  const feePerSide = Number(feeArg ?? 0.05);
  const kvList = (kvArg ?? '2,3,4,5,6').split(',').map(Number);
  const tpPct = Number(tpArg ?? 5);

  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;
  console.log(`\nFetching ${symbol} ${interval} (${days}d)...`);
  const candles = await fetchKlines(symbol, interval, startMs, endMs);
  console.log(`${candles.length} candles  ${candles[0]?.openTime.toISOString().slice(0, 10)} → ${candles[candles.length - 1]?.openTime.toISOString().slice(0, 10)}`);

  console.log(`\n=== ${symbol} ${interval} | ATR(${ATR_PERIOD}) | $${capital} compounding | fee ${feePerSide}%/side | partial ${tpPct}% on ${PARTIAL_FRACTION * 100}% ===`);
  console.log('         BASELINE (flip, no TP)                  |  NEW (+%TP partial + breakeven runner)');
  console.log('kv | trades  winRate    final$    ret%   maxDD%  | trades  winRate    final$    ret%   maxDD%  prt  be');
  for (const kv of kvList) {
    const b = runFlip(candles, kv, capital, feePerSide);
    const n = runFlipPartial(candles, kv, capital, feePerSide, tpPct);
    const base =
      `${String(b.trades).padStart(6)} ${fmt(b.winRate * 100).padStart(6)}% ${('$' + fmt(b.finalEquity)).padStart(10)} ${((b.returnPct >= 0 ? '+' : '') + fmt(b.returnPct, 0)).padStart(6)}% ${fmt(b.maxDD, 0).padStart(5)}%`;
    const neu =
      `${String(n.trades).padStart(6)} ${fmt(n.winRate * 100).padStart(6)}% ${('$' + fmt(n.finalEquity)).padStart(10)} ${((n.returnPct >= 0 ? '+' : '') + fmt(n.returnPct, 0)).padStart(6)}% ${fmt(n.maxDD, 0).padStart(5)}%`;
    console.log(`${String(kv).padStart(2)} | ${base}  | ${neu}  ${String(n.partials ?? 0).padStart(3)} ${String(n.breakevens ?? 0).padStart(3)}`);
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
