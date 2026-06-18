/**
 * M30 TP/SL solution: ATR-scaled bracket on the UTBot flip signal.
 *
 * Why: a fixed +5% TP almost never triggers on M30 (trend legs are too short). Scale the
 * exits to volatility instead.
 *
 * Rules:
 *   - Direction: UTBot trend (keyValue). Enter at the candle CLOSE on the first signal and
 *     on every flip. ONE trade per trend leg — after a stop-out we wait for the next flip
 *     to re-enter (defined-risk, no always-in-market churn).
 *   - At entry compute ATR(entry). Hard initial SL = entry ∓ sl×ATR (intra-candle fill).
 *   - TP1 = entry ± tp1×ATR → close HALF (intra-candle) and move SL to breakeven (entry).
 *   - Runner: trail a chandelier stop = extreme-since-entry ∓ trail×ATR, floored at breakeven,
 *     and also exit on the UTBot flip (close). Whichever hits first.
 *   - Fees = open + partial-close(half) + final-close = 2×feePerSide per trade. No leverage/slippage.
 *
 * Usage:
 *   ts-node --project apps/api/tsconfig.json scripts/run-flip-atr-bracket-backtest.ts \
 *     [symbol] [interval] [days] [capital] [feePctPerSide] [kv] [trailMult] [slList] [tp1List]
 *   e.g. ... ETHUSDT 30m 365 1000 0.05 8 3 "1,1.5,2" "1,1.5,2,3"
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

type Pos = { dir: 'long' | 'short'; entry: number; atr: number; sl: number; partialDone: boolean; extreme: number; tp1: number };
type Result = { trades: number; winRate: number; returnPct: number; maxDD: number; partials: number };

function runBracket(
  candles: Candle[],
  atr: number[],
  keyValue: number,
  capital: number,
  feePerSide: number,
  slMult: number,
  tp1Mult: number,
  trailMult: number,
): Result {
  const stop = utBotStops(candles, ATR_PERIOD, keyValue);
  const fee = feePerSide / 100;
  const trendAt = (i: number): 'bull' | 'bear' | null => {
    if (i < ATR_PERIOD || stop[i] === 0) return null;
    return candles[i]!.close > stop[i]! ? 'bull' : 'bear';
  };

  const rets: number[] = [];
  let partials = 0;
  let pos: Pos | null = null;
  let prevTrend: 'bull' | 'bear' | null = null;

  const closeTrade = (p: Pos, exitPrice: number) => {
    const remFrac = p.partialDone ? 1 - PARTIAL_FRACTION : 1;
    const grossRem = p.dir === 'long' ? (exitPrice - p.entry) / p.entry : (p.entry - exitPrice) / p.entry;
    const grossPartial = p.partialDone ? PARTIAL_FRACTION * (p.dir === 'long' ? (p.tp1 - p.entry) / p.entry : (p.entry - p.tp1) / p.entry) : 0;
    rets.push(grossPartial + remFrac * grossRem - 2 * fee);
  };

  const openAt = (i: number, t: 'bull' | 'bear'): Pos => {
    const e = candles[i]!.close;
    const a = atr[i]!;
    const dir = t === 'bull' ? 'long' : 'short';
    return {
      dir,
      entry: e,
      atr: a,
      sl: dir === 'long' ? e - slMult * a : e + slMult * a,
      partialDone: false,
      extreme: e,
      tp1: dir === 'long' ? e + tp1Mult * a : e - tp1Mult * a,
    };
  };

  for (let i = ATR_PERIOD; i < candles.length; i++) {
    const t = trendAt(i);
    if (t === null) continue;
    const c = candles[i]!;

    if (pos) {
      const long = pos.dir === 'long';
      pos.extreme = long ? Math.max(pos.extreme, c.high) : Math.min(pos.extreme, c.low);

      // Current stop: hard SL pre-partial; chandelier floored at breakeven post-partial.
      const stopLvl = !pos.partialDone
        ? pos.sl
        : long
          ? Math.max(pos.entry, pos.extreme - trailMult * pos.atr)
          : Math.min(pos.entry, pos.extreme + trailMult * pos.atr);

      // 1. Stop hit intra-candle (conservative: checked before TP).
      const stopHit = long ? c.low <= stopLvl : c.high >= stopLvl;
      if (stopHit) {
        closeTrade(pos, stopLvl);
        pos = null;
        prevTrend = t; // flat; wait for next flip to re-enter
        continue;
      }

      // 2. TP1 hit intra-candle → bank half, ratchet to breakeven.
      if (!pos.partialDone) {
        const tpHit = long ? c.high >= pos.tp1 : c.low <= pos.tp1;
        if (tpHit) {
          pos.partialDone = true;
          partials++;
        }
      }

      // 3. Flip on close → exit remainder and reverse.
      if (t !== prevTrend) {
        closeTrade(pos, c.close);
        pos = openAt(i, t);
        prevTrend = t;
        continue;
      }
      continue;
    }

    // Flat: open on the first signal or on a flip; otherwise wait.
    if (prevTrend === null || t !== prevTrend) {
      pos = openAt(i, t);
    }
    prevTrend = t;
  }

  if (pos) closeTrade(pos, candles[candles.length - 1]!.close);

  const wins = rets.filter((r) => r > 0).length;
  let eq = capital, peak = capital, maxDD = 0;
  for (const r of rets) {
    eq *= 1 + r;
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return {
    trades: rets.length,
    winRate: rets.length ? (wins / rets.length) * 100 : 0,
    returnPct: (eq / capital - 1) * 100,
    maxDD: maxDD * 100,
    partials,
  };
}

async function main() {
  const [, , symArg, intArg, daysArg, capArg, feeArg, kvArg, trailArg, slArg, tpArg] = process.argv;
  const symbol = symArg ?? 'ETHUSDT';
  const interval = intArg ?? '30m';
  const days = Number(daysArg ?? 365);
  const capital = Number(capArg ?? 1000);
  const feePerSide = Number(feeArg ?? 0.05);
  const kv = Number(kvArg ?? 8);
  const trailMult = Number(trailArg ?? 3);
  const slList = (slArg ?? '1,1.5,2').split(',').map(Number);
  const tpList = (tpArg ?? '1,1.5,2,3').split(',').map(Number);

  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;
  console.log(`\nFetching ${symbol} ${interval} (${days}d)...`);
  const candles = await fetchKlines(symbol, interval, startMs, endMs);
  const atr = wilderAtr(candles, ATR_PERIOD);
  console.log(`${candles.length} candles  ${candles[0]?.openTime.toISOString().slice(0, 10)} → ${candles[candles.length - 1]?.openTime.toISOString().slice(0, 10)}`);

  console.log(`\n=== ${symbol} ${interval} | ATR(${ATR_PERIOD}) bracket | kv=${kv} | trail=${trailMult}×ATR | $${capital} | fee ${feePerSide}%/side ===`);
  console.log('  SL    TP1  | trades  winRate    final$    ret%   maxDD%  partials');
  let best: { sl: number; tp1: number; r: Result } | null = null;
  for (const sl of slList) {
    for (const tp1 of tpList) {
      const r = runBracket(candles, atr, kv, capital, feePerSide, sl, tp1, trailMult);
      const fin = capital * (1 + r.returnPct / 100);
      console.log(
        `  ${fmt(sl, 1)}   ${fmt(tp1, 1)}  | ${String(r.trades).padStart(6)} ${fmt(r.winRate).padStart(6)}% ${('$' + fmt(fin)).padStart(10)} ${((r.returnPct >= 0 ? '+' : '') + fmt(r.returnPct, 0)).padStart(6)}% ${fmt(r.maxDD, 0).padStart(5)}% ${String(r.partials).padStart(8)}`,
      );
      if (!best || r.returnPct > best.r.returnPct) best = { sl, tp1, r };
    }
  }
  if (best) {
    console.log(`\nBest: SL=${best.sl}×ATR  TP1=${best.tp1}×ATR → ${(best.r.returnPct >= 0 ? '+' : '') + fmt(best.r.returnPct, 0)}%  (DD ${fmt(best.r.maxDD, 0)}%, WR ${fmt(best.r.winRate)}%, ${best.r.trades} trades)`);
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
