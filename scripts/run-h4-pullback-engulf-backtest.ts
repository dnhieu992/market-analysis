/**
 * NEW swing strategy — H4 ONLY: UTBot trend, wait for a pullback to the trend line, enter on
 * an engulfing candle, one position per leg (no scale-ins).
 *
 * Trend: UTBot stop-and-reverse on candle CLOSE. trend = close > stop ? bull : bear.
 *   The UTBot stop line is the "trend line". A confirmed flip starts a new trend leg.
 *
 * Entry (the new rule):
 *   - On a flip we DO NOT enter. We wait for price to pull back close to the line and confirm:
 *   - BULL: enter LONG on a candle that is BOTH (a) within `bandPct` of the line
 *           (dist = |close-line|/line ≤ band) AND (b) a bullish engulfing
 *           (close>open AND close>previous high).
 *   - BEAR: mirror — within band of the line AND bearish engulfing (close<open AND close<prev low).
 *   - Max ONE position per trend leg (no adds / no scale-in).
 *   - If no qualifying candle appears before the trend flips, the leg is SKIPPED.
 *   - Exit: the next confirmed UTBot flip (close at that candle's close).
 *
 * CURRENT (reference): the live page behaviour — enter immediately at the flip close, exit on flip.
 *
 * H4 only. Sizing flat $notional/leg (default $100), fee 0.05%/side. No add-on either side.
 *
 * Usage:
 *   ts-node --project apps/api/tsconfig.json scripts/run-h4-pullback-engulf-backtest.ts \
 *     [days] [feePctPerSide] [bandPct] [notional] [symbol] [keyValue]
 *   - No symbol → runs the default H4 config set. Interval is always 4h.
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const ATR_PERIOD = 10;
const INTERVAL = '4h';

const H4_CONFIGS: { symbol: string; keyValue: number; live: boolean }[] = [
  { symbol: 'ETHUSDT', keyValue: 2, live: true }, // live page (4h kv=2)
  { symbol: 'BNBUSDT', keyValue: 4, live: true }, // live page (4h kv=4)
  { symbol: 'BTCUSDT', keyValue: 2, live: false }, // extra H4 sample
  { symbol: 'SOLUSDT', keyValue: 2, live: false }, // extra H4 sample
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
  legs: number;
  wins: number;
  winRate: number;
  netPnl: number;
  maxDD: number;
  trendLegs: number;
  entered: number;
  skipped: number;
  avgDelay: number;
};

type Mode = 'immediate' | 'pullbackEngulf';

function runStrategy(candles: Candle[], keyValue: number, feePerSide: number, bandPct: number, notional: number, mode: Mode): Result {
  const stop = utBotStops(candles, ATR_PERIOD, keyValue);
  const fee = feePerSide / 100;
  const band = bandPct / 100;

  const trendAt = (i: number): 'bull' | 'bear' | null => {
    if (i < ATR_PERIOD || stop[i] === 0) return null;
    return candles[i]!.close > stop[i]! ? 'bull' : 'bear';
  };

  const pnls: number[] = [];
  let prevTrend: 'bull' | 'bear' | null = null;
  let openDir: 'long' | 'short' | null = null;
  let openEntry = 0;
  let legStartIdx = -1;
  let trendLegs = 0, entered = 0, delaySum = 0;

  const closeBase = (exit: number) => {
    if (openDir === null) return;
    const gross = openDir === 'long' ? (exit - openEntry) / openEntry : (openEntry - exit) / openEntry;
    pnls.push(notional * gross - notional * fee * 2);
    openDir = null;
  };

  for (let i = ATR_PERIOD; i < candles.length; i++) {
    const t = trendAt(i);
    if (t === null) continue;
    const c = candles[i]!;
    const p = candles[i - 1]!;
    const line = stop[i]!;
    const dist = line !== 0 ? Math.abs(c.close - line) / line : Infinity;

    // First leg
    if (prevTrend === null) {
      trendLegs++;
      legStartIdx = i;
      prevTrend = t;
      if (mode === 'immediate') {
        openDir = t === 'bull' ? 'long' : 'short';
        openEntry = c.close;
        entered++;
      }
      continue;
    }

    // Flip → close, start new leg
    if (t !== prevTrend) {
      closeBase(c.close);
      trendLegs++;
      legStartIdx = i;
      prevTrend = t;
      if (mode === 'immediate') {
        openDir = t === 'bull' ? 'long' : 'short';
        openEntry = c.close;
        entered++;
      }
      continue;
    }

    // Same trend, no position yet → look for pullback-to-line + engulfing
    if (mode === 'pullbackEngulf' && openDir === null) {
      if (t === 'bull') {
        const engulf = c.close > c.open && c.close > p.high;
        if (engulf && dist <= band) {
          openDir = 'long';
          openEntry = c.close;
          entered++;
          delaySum += i - legStartIdx;
        }
      } else {
        const engulf = c.close < c.open && c.close < p.low;
        if (engulf && dist <= band) {
          openDir = 'short';
          openEntry = c.close;
          entered++;
          delaySum += i - legStartIdx;
        }
      }
    }
  }

  if (openDir !== null) {
    const last = candles[candles.length - 1]!.close;
    const gross = openDir === 'long' ? (last - openEntry) / openEntry : (openEntry - last) / openEntry;
    pnls.push(notional * gross - notional * fee);
  }

  const skipped = trendLegs - entered;
  const wins = pnls.filter((x) => x > 0).length;
  const netPnl = pnls.reduce((a, b) => a + b, 0);
  let cum = 0, peak = 0, maxDD = 0;
  for (const x of pnls) {
    cum += x;
    if (cum > peak) peak = cum;
    if (peak - cum > maxDD) maxDD = peak - cum;
  }

  return { legs: pnls.length, wins, winRate: pnls.length ? wins / pnls.length : 0, netPnl, maxDD, trendLegs, entered, skipped, avgDelay: entered ? delaySum / entered : 0 };
}

async function runConfig(symbol: string, keyValue: number, live: boolean, days: number, feePerSide: number, bandPct: number, notional: number) {
  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;
  const candles = await fetchKlines(symbol, INTERVAL, startMs, endMs);
  const cur = runStrategy(candles, keyValue, feePerSide, bandPct, notional, 'immediate');
  const neo = runStrategy(candles, keyValue, feePerSide, bandPct, notional, 'pullbackEngulf');
  const delta = neo.netPnl - cur.netPnl;
  const range = `${candles[0]?.openTime.toISOString().slice(0, 10)}→${candles[candles.length - 1]?.openTime.toISOString().slice(0, 10)}`;

  console.log(`${(symbol + ' 4h').padEnd(11)} kv=${keyValue} ${live ? '(live)' : '(extra)'} | ${candles.length} candles ${range} | ${cur.trendLegs} trend legs`);
  console.log(
    `   CURRENT (enter at flip)        : trades ${String(cur.legs).padStart(3)}  win ${fmt(cur.winRate * 100).padStart(5)}%  ` +
      `net ${('$' + fmt(cur.netPnl)).padStart(9)}  maxDD ${('$' + fmt(cur.maxDD)).padStart(8)}`,
  );
  console.log(
    `   NEW (pullback≤${bandPct}% + engulf)     : trades ${String(neo.legs).padStart(3)}  win ${fmt(neo.winRate * 100).padStart(5)}%  ` +
      `net ${('$' + fmt(neo.netPnl)).padStart(9)}  maxDD ${('$' + fmt(neo.maxDD)).padStart(8)}   Δ ${(delta >= 0 ? '+' : '') + fmt(delta)}`,
  );
  console.log(`   entries: ${neo.entered}/${neo.trendLegs} legs, ${neo.skipped} skipped (no pullback+engulf), avg delay ${fmt(neo.avgDelay, 1)} candles\n`);
  return { delta, cur: cur.netPnl, neo: neo.netPnl };
}

async function main() {
  const [, , daysArg, feeArg, bandArg, notionalArg, symArg, kvArg] = process.argv;
  const days = Number(daysArg ?? 365);
  const feePerSide = Number(feeArg ?? 0.05);
  const bandPct = Number(bandArg ?? 1);
  const notional = Number(notionalArg ?? 100);

  console.log(
    `\n=== H4-ONLY: UTBot trend + pullback≤${bandPct}% to line + engulfing entry | 1 pos/leg, no adds | ` +
      `ATR(${ATR_PERIOD}) | $${notional}/leg | fee ${feePerSide}%/side | ${days}d ===\n`,
  );

  const configs = symArg ? [{ symbol: symArg, keyValue: Number(kvArg ?? 2), live: false }] : H4_CONFIGS;
  let tCur = 0, tNeo = 0;
  for (const c of configs) {
    const r = await runConfig(c.symbol, c.keyValue, c.live, days, feePerSide, bandPct, notional);
    tCur += r.cur;
    tNeo += r.neo;
  }
  if (configs.length > 1) {
    console.log(`TOTAL  CURRENT $${fmt(tCur)}  |  NEW $${fmt(tNeo)}  |  Δ ${(tNeo - tCur >= 0 ? '+' : '') + fmt(tNeo - tCur)}\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
