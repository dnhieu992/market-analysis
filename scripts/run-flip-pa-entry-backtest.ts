/**
 * Backtest: UTBot decides the TREND, price action decides the ENTRY.
 *
 * Trend filter (unchanged): UTBot stop-and-reverse on candle CLOSE.
 *   trend = close > stop ? bull : bear. A confirmed flip ends the current leg.
 *
 * CURRENT (live page): enter the base immediately at the flip close, exit on the next flip.
 *
 * NEW (this script): inside a UTBot trend, wait for a price-action entry, max ONE base per leg.
 *   - Pullback + engulfing (the rule the user picked):
 *       BULL: after ≥1 candle that closes below the previous close (a pullback), enter LONG on
 *             the first candle that is bullish (close>open) AND closes above the previous
 *             candle's HIGH (engulfs/breaks the prior bar up).
 *       BEAR: mirror — after ≥1 candle closing above the previous close, enter SHORT on the
 *             first bearish candle (close<open) closing below the previous candle's LOW.
 *   - If no such signal appears before the trend flips, the leg is SKIPPED (flat for that leg).
 *   - Exit: the next confirmed UTBot flip (close the base at that candle's close).
 *
 * Add-on is OFF in both arms to isolate the pure entry-timing effect (the pullback scale-in is
 * a separate, already-characterised amplifier). Sizing: flat $notional/leg (default $100).
 *
 * Usage:
 *   ts-node --project apps/api/tsconfig.json scripts/run-flip-pa-entry-backtest.ts \
 *     [days] [feePctPerSide] [notional] [symbol] [interval] [keyValue]
 *   - With no symbol it runs the 4 live SWING_PAIRS.
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const ATR_PERIOD = 10;

// Mirrors apps/worker/src/modules/swing-trading/swing-pairs.ts
const LIVE_PAIRS: { symbol: string; interval: string; keyValue: number }[] = [
  { symbol: 'ETHUSDT', interval: '4h', keyValue: 2 },
  { symbol: 'BTCUSDT', interval: '1d', keyValue: 2 },
  { symbol: 'BNBUSDT', interval: '4h', keyValue: 4 },
  { symbol: 'SOLUSDT', interval: '1d', keyValue: 2 },
];

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
  const tr = c.map((x, i) =>
    i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1]!.close), Math.abs(x.low - c[i - 1]!.close)),
  );
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
  legs: number; // realised trades (closed + final MTM)
  wins: number;
  winRate: number;
  netPnl: number;
  maxDD: number;
  trendLegs: number; // total UTBot trend legs in window
  entered: number; // legs where a base was actually opened
  skipped: number; // legs with no valid PA signal before the flip (NEW only)
  avgDelay: number; // avg candles from flip to PA entry (NEW only)
};

type Mode = 'immediate' | 'pa';

function runStrategy(candles: Candle[], keyValue: number, feePerSide: number, notional: number, mode: Mode): Result {
  const stop = utBotStops(candles, ATR_PERIOD, keyValue);
  const fee = feePerSide / 100;

  const trendAt = (i: number): 'bull' | 'bear' | null => {
    if (i < ATR_PERIOD || stop[i] === 0) return null;
    return candles[i]!.close > stop[i]! ? 'bull' : 'bear';
  };

  const pnls: number[] = [];
  let prevTrend: 'bull' | 'bear' | null = null;
  // current open base
  let openDir: 'long' | 'short' | null = null;
  let openEntry = 0;
  // per-leg PA state
  let legStartIdx = -1;
  let pullbackSeen = false;
  let trendLegs = 0, entered = 0, skipped = 0, delaySum = 0;

  const closeBase = (exit: number) => {
    if (openDir === null) return;
    const gross = openDir === 'long' ? (exit - openEntry) / openEntry : (openEntry - exit) / openEntry;
    pnls.push(notional * gross - notional * fee * 2);
    openDir = null;
  };

  const startLeg = (i: number) => {
    legStartIdx = i;
    pullbackSeen = false;
    trendLegs++;
  };

  for (let i = ATR_PERIOD; i < candles.length; i++) {
    const t = trendAt(i);
    if (t === null) continue;
    const c = candles[i]!;
    const p = candles[i - 1]!;

    // First observed trend
    if (prevTrend === null) {
      startLeg(i);
      prevTrend = t;
      if (mode === 'immediate') {
        openDir = t === 'bull' ? 'long' : 'short';
        openEntry = c.close;
        entered++;
      }
      continue;
    }

    // Confirmed flip → close any open base at this close, then start the new leg
    if (t !== prevTrend) {
      closeBase(c.close);
      if (mode === 'immediate' || openDir === null) {
        // (skip counting handled below for PA legs without entry)
      }
      const hadEntryLastLeg = entered; // snapshot not needed; tracked via openDir reset
      void hadEntryLastLeg;
      startLeg(i);
      prevTrend = t;
      if (mode === 'immediate') {
        openDir = t === 'bull' ? 'long' : 'short';
        openEntry = c.close;
        entered++;
      }
      continue;
    }

    // Same trend, PA mode, no base yet → look for pullback + engulfing
    if (mode === 'pa' && openDir === null) {
      if (t === 'bull') {
        if (c.close < p.close) pullbackSeen = true;
        const engulf = c.close > c.open && c.close > p.high;
        if (pullbackSeen && engulf) {
          openDir = 'long';
          openEntry = c.close;
          entered++;
          delaySum += i - legStartIdx;
        }
      } else {
        if (c.close > p.close) pullbackSeen = true;
        const engulf = c.close < c.open && c.close < p.low;
        if (pullbackSeen && engulf) {
          openDir = 'short';
          openEntry = c.close;
          entered++;
          delaySum += i - legStartIdx;
        }
      }
    }
  }

  // Close any still-open base at the last close (closing-side fee only)
  if (openDir !== null) {
    const last = candles[candles.length - 1]!.close;
    const gross = openDir === 'long' ? (last - openEntry) / openEntry : (openEntry - last) / openEntry;
    pnls.push(notional * gross - notional * fee);
  }

  skipped = trendLegs - entered;
  const wins = pnls.filter((x) => x > 0).length;
  const netPnl = pnls.reduce((a, b) => a + b, 0);
  let cum = 0, peak = 0, maxDD = 0;
  for (const x of pnls) {
    cum += x;
    if (cum > peak) peak = cum;
    if (peak - cum > maxDD) maxDD = peak - cum;
  }

  return {
    legs: pnls.length,
    wins,
    winRate: pnls.length ? wins / pnls.length : 0,
    netPnl,
    maxDD,
    trendLegs,
    entered,
    skipped,
    avgDelay: entered ? delaySum / entered : 0,
  };
}

async function runConfig(symbol: string, interval: string, keyValue: number, days: number, feePerSide: number, notional: number) {
  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;
  const candles = await fetchKlines(symbol, interval, startMs, endMs);
  const cur = runStrategy(candles, keyValue, feePerSide, notional, 'immediate');
  const pa = runStrategy(candles, keyValue, feePerSide, notional, 'pa');
  const delta = pa.netPnl - cur.netPnl;
  const range = `${candles[0]?.openTime.toISOString().slice(0, 10)}→${candles[candles.length - 1]?.openTime.toISOString().slice(0, 10)}`;

  console.log(`${(symbol + ' ' + interval).padEnd(13)} kv=${keyValue} | ${candles.length} candles ${range} | ${cur.trendLegs} UTBot trend legs`);
  console.log(
    `   CURRENT (enter at flip)   : trades ${String(cur.legs).padStart(3)}  win ${fmt(cur.winRate * 100).padStart(5)}%  ` +
      `net ${('$' + fmt(cur.netPnl)).padStart(9)}  maxDD ${('$' + fmt(cur.maxDD)).padStart(8)}`,
  );
  console.log(
    `   NEW (PA pullback+engulf)  : trades ${String(pa.legs).padStart(3)}  win ${fmt(pa.winRate * 100).padStart(5)}%  ` +
      `net ${('$' + fmt(pa.netPnl)).padStart(9)}  maxDD ${('$' + fmt(pa.maxDD)).padStart(8)}   Δ ${(delta >= 0 ? '+' : '') + fmt(delta)}`,
  );
  console.log(`   PA entries: ${pa.entered}/${pa.trendLegs} legs entered, ${pa.skipped} skipped (no signal), avg delay ${fmt(pa.avgDelay, 1)} candles after flip\n`);
}

async function main() {
  const [, , daysArg, feeArg, notionalArg, symArg, intArg, kvArg] = process.argv;
  const days = Number(daysArg ?? 365);
  const feePerSide = Number(feeArg ?? 0.05);
  const notional = Number(notionalArg ?? 100);

  console.log(
    `\n=== UTBot trend + PA entry (pullback+engulfing) | ATR(${ATR_PERIOD}) | $${notional}/leg flat | fee ${feePerSide}%/side | no add-on | ${days}d ===\n`,
  );

  const configs = symArg && intArg ? [{ symbol: symArg, interval: intArg, keyValue: Number(kvArg ?? 2) }] : LIVE_PAIRS;
  for (const c of configs) {
    await runConfig(c.symbol, c.interval, c.keyValue, days, feePerSide, notional);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
