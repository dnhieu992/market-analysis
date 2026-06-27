/**
 * BTC daily price statistics from 2017 to now (spot BTCUSDT, 1d candles).
 *
 * Reports:
 *   1. Number of UP days   (close > previous close)
 *   2. Number of DOWN days (close < previous close)
 *   3. Number of FLAT days (close == previous close)
 *   4. Drawdown episodes using a 10% reversal filter (zigzag):
 *      - From a confirmed peak, price declines.
 *      - The bottom of the decline is CONFIRMED only once price rebounds >= 10%
 *        off the lowest low reached.
 *      - For each episode we report the max drop % (peak close -> trough low).
 *      - The deepest such drop is the headline "giảm nhiều nhất ... trước khi hồi 10%+".
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-btc-daily-stats.ts [symbol] [recoveryPct]
 *   e.g. ... BTCUSDT 10
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

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtUsd(n: number): string {
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

type Episode = { peakDate: Date; peakPrice: number; troughDate: Date; troughPrice: number; dropPct: number };

/**
 * Walk daily candles, segmenting peak->trough declines confirmed by a >= recoveryPct
 * rebound off the low. Returns every confirmed drawdown episode.
 */
function findDrawdownEpisodes(candles: Candle[], recoveryPct: number): Episode[] {
  const episodes: Episode[] = [];
  if (candles.length === 0) return episodes;

  // State: tracking from a running peak down to the lowest low seen so far.
  let peakPrice = candles[0]!.close;
  let peakDate = candles[0]!.openTime;
  let troughPrice = candles[0]!.low;
  let troughDate = candles[0]!.openTime;
  let inDrawdown = false;

  const recover = 1 + recoveryPct / 100;

  for (const c of candles) {
    // New high above current peak -> reset reference peak (no active drawdown).
    if (c.high >= peakPrice) {
      peakPrice = c.high;
      peakDate = c.openTime;
      troughPrice = c.high;
      troughDate = c.openTime;
      inDrawdown = false;
      continue;
    }

    // Track the lowest low of the current decline.
    if (c.low < troughPrice) {
      troughPrice = c.low;
      troughDate = c.openTime;
      inDrawdown = true;
    }

    // Confirm the bottom once price rebounds >= recoveryPct off the trough.
    if (inDrawdown && c.high >= troughPrice * recover) {
      const dropPct = ((peakPrice - troughPrice) / peakPrice) * 100;
      episodes.push({ peakDate, peakPrice, troughDate, troughPrice, dropPct });
      // Restart from the rebound: this candle becomes the new running peak.
      peakPrice = c.high;
      peakDate = c.openTime;
      troughPrice = c.high;
      troughDate = c.openTime;
      inDrawdown = false;
    }
  }

  return episodes;
}

async function main() {
  const symbol = process.argv[2] ?? 'BTCUSDT';
  const recoveryPct = parseFloat(process.argv[3] ?? '10');

  const start = Date.UTC(2017, 0, 1); // 2017-01-01 (Binance BTCUSDT spot begins Aug 2017)
  const end = Date.now();

  console.log(`Fetching ${symbol} 1d candles from ${fmtDate(new Date(start))} to ${fmtDate(new Date(end))} ...`);
  const candles = await fetchKlines(symbol, '1d', start, end);
  console.log(`Got ${candles.length} daily candles (first: ${fmtDate(candles[0]!.openTime)}, last: ${fmtDate(candles[candles.length - 1]!.openTime)})\n`);

  // 1-3. Up / down / flat days by close-to-close.
  let up = 0, down = 0, flat = 0;
  let biggestUpPct = 0, biggestUpDate = candles[0]!.openTime;
  let biggestDownPct = 0, biggestDownDate = candles[0]!.openTime;
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1]!.close;
    const cur = candles[i]!.close;
    const chg = ((cur - prev) / prev) * 100;
    if (cur > prev) {
      up++;
      if (chg > biggestUpPct) { biggestUpPct = chg; biggestUpDate = candles[i]!.openTime; }
    } else if (cur < prev) {
      down++;
      if (chg < biggestDownPct) { biggestDownPct = chg; biggestDownDate = candles[i]!.openTime; }
    } else {
      flat++;
    }
  }
  const counted = up + down + flat;

  console.log('=== Up / Down days (close-to-close) ===');
  console.log(`Total days compared : ${counted}`);
  console.log(`Up days   : ${up}  (${((up / counted) * 100).toFixed(1)}%)`);
  console.log(`Down days : ${down}  (${((down / counted) * 100).toFixed(1)}%)`);
  console.log(`Flat days : ${flat}  (${((flat / counted) * 100).toFixed(1)}%)`);
  console.log(`Biggest single-day gain : +${biggestUpPct.toFixed(2)}% on ${fmtDate(biggestUpDate)}`);
  console.log(`Biggest single-day loss : ${biggestDownPct.toFixed(2)}% on ${fmtDate(biggestDownDate)}\n`);

  // 4. Drawdown episodes with recoveryPct reversal filter.
  const episodes = findDrawdownEpisodes(candles, recoveryPct);
  episodes.sort((a, b) => b.dropPct - a.dropPct);

  console.log(`=== Drawdowns confirmed by a >= ${recoveryPct}% rebound (deepest first) ===`);
  console.log(`Total confirmed drawdown episodes: ${episodes.length}\n`);
  console.log('  drop%   peak date   peak price     trough date  trough price   days');
  for (const e of episodes.slice(0, 20)) {
    const days = Math.round((e.troughDate.getTime() - e.peakDate.getTime()) / 86400000);
    console.log(
      `  ${e.dropPct.toFixed(1).padStart(5)}%  ${fmtDate(e.peakDate)}  ${fmtUsd(e.peakPrice).padStart(10)}   ` +
      `${fmtDate(e.troughDate)}  ${fmtUsd(e.troughPrice).padStart(10)}   ${String(days).padStart(4)}`,
    );
  }

  if (episodes.length > 0) {
    const worst = episodes[0]!;
    console.log(
      `\n>>> Deepest drop before a >=${recoveryPct}% recovery: ` +
      `-${worst.dropPct.toFixed(1)}%  (${fmtUsd(worst.peakPrice)} on ${fmtDate(worst.peakDate)} ` +
      `-> ${fmtUsd(worst.troughPrice)} on ${fmtDate(worst.troughDate)})`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
