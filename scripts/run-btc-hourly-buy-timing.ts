/**
 * BTC HOURLY BUY TIMING — which hour of the day (UTC and UTC+7) is statistically
 * the cheapest to buy BTC, for a daily DCA buy strategy.
 *
 * Method (no lookahead needed — this is descriptive statistics, not a forward strategy):
 *   1. Fetch BTCUSDT 1h candles for N days.
 *   2. Group candles into UTC calendar days (00:00 UTC -> 23:00 UTC).
 *   3. For each day, compute the day's mean close (avg of its 24 hourly closes).
 *   4. For each hour h (0-23), compute relPct = (close_h - dayMean) / dayMean * 100.
 *      Average relPct across all days for that hour -> negative = that hour tends to
 *      trade BELOW the day's average price (cheaper), positive = above (expensive).
 *   5. Also compute, for each day, which hour has the MIN close (argmin) and the
 *      MAX close (argmax) -> frequency count per hour = "how often is this the
 *      cheapest/priciest hour of the day".
 *   6. Report both in UTC and in UTC+7 (Vietnam local time) since the buyer is
 *      likely placing orders on VN time.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-btc-hourly-buy-timing.ts [symbol] [days]
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const HOUR_MS = 36e5;
const DAY_MS = 864e5;

type Candle = { t: number; open: number; high: number; low: number; close: number };

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
  const out: Candle[] = [];
  let cur = startMs;
  while (cur < endMs) {
    const url = `${BINANCE_HOST}?symbol=${symbol}&interval=${interval}&startTime=${cur}&endTime=${endMs}&limit=${MAX_PER_REQ}`;
    const batch = (await fetchJson(url)) as unknown[][];
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const k of batch) {
      out.push({ t: k[0] as number, open: +(k[1] as string), high: +(k[2] as string), low: +(k[3] as string), close: +(k[4] as string) });
    }
    if (batch.length < MAX_PER_REQ) break;
    cur = (batch[batch.length - 1]![0] as number) + 1;
  }
  return out;
}

const fmt = (n: number, d = 3) => (n >= 0 ? '+' : '') + n.toFixed(d);

function main2(symbol: string, days: number) {
  return (async () => {
    const endMs = Date.now();
    const startMs = endMs - (days + 2) * DAY_MS;
    console.log(`\nFetching ${symbol} 1h candles for ~${days}d ...`);
    const candles = await fetchKlines(symbol, '1h', startMs, endMs);
    console.log(`Got ${candles.length} hourly candles (${new Date(candles[0]!.t).toISOString()} -> ${new Date(candles[candles.length - 1]!.t).toISOString()})`);

    // Group by UTC calendar day, keep only full 24h days.
    const byDay = new Map<number, Candle[]>();
    for (const c of candles) {
      const d = new Date(c.t);
      const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      if (!byDay.has(dayStart)) byDay.set(dayStart, []);
      byDay.get(dayStart)!.push(c);
    }

    const relSum = new Array(24).fill(0);
    const relCount = new Array(24).fill(0);
    const minCount = new Array(24).fill(0);
    const maxCount = new Array(24).fill(0);
    let fullDays = 0;

    for (const [, cands] of byDay) {
      if (cands.length !== 24) continue; // skip partial days (first/last)
      cands.sort((a, b) => a.t - b.t);
      const dayMean = cands.reduce((s, c) => s + c.close, 0) / 24;
      let minIdx = 0, maxIdx = 0;
      for (let h = 0; h < 24; h++) {
        const rel = ((cands[h]!.close - dayMean) / dayMean) * 100;
        relSum[h] += rel;
        relCount[h]++;
        if (cands[h]!.close < cands[minIdx]!.close) minIdx = h;
        if (cands[h]!.close > cands[maxIdx]!.close) maxIdx = h;
      }
      minCount[minIdx]++;
      maxCount[maxIdx]++;
      fullDays++;
    }

    console.log(`\n=== ${symbol} · ${fullDays} full UTC days analyzed ===`);
    console.log(`Avg %-below/above the day's mean close, by hour (negative = cheaper than average):\n`);
    console.log('UTC  VN(+7)  avgRel%    cheapest-hour-freq   priciest-hour-freq');
    console.log('-'.repeat(70));

    const rows = [];
    for (let h = 0; h < 24; h++) {
      const avgRel = relSum[h] / relCount[h];
      const vnHour = (h + 7) % 24;
      rows.push({ h, vnHour, avgRel, minPct: (minCount[h] / fullDays) * 100, maxPct: (maxCount[h] / fullDays) * 100 });
    }

    for (const r of rows) {
      console.log(
        `${String(r.h).padStart(2, '0')}:00  ${String(r.vnHour).padStart(2, '0')}:00   ${fmt(r.avgRel).padStart(8)}%   ` +
        `${r.minPct.toFixed(1).padStart(5)}%               ${r.maxPct.toFixed(1).padStart(5)}%`,
      );
    }

    const bestByAvg = [...rows].sort((a, b) => a.avgRel - b.avgRel)[0]!;
    const worstByAvg = [...rows].sort((a, b) => b.avgRel - a.avgRel)[0]!;
    const bestByFreq = [...rows].sort((a, b) => b.minPct - a.minPct)[0]!;

    console.log(`\n>>> Cheapest hour on average: ${String(bestByAvg.h).padStart(2, '0')}:00 UTC (${String(bestByAvg.vnHour).padStart(2, '0')}:00 VN) — ${fmt(bestByAvg.avgRel)}% vs day mean`);
    console.log(`>>> Most expensive hour on average: ${String(worstByAvg.h).padStart(2, '0')}:00 UTC (${String(worstByAvg.vnHour).padStart(2, '0')}:00 VN) — ${fmt(worstByAvg.avgRel)}% vs day mean`);
    console.log(`>>> Hour most often the day's LOW: ${String(bestByFreq.h).padStart(2, '0')}:00 UTC (${String(bestByFreq.vnHour).padStart(2, '0')}:00 VN) — ${bestByFreq.minPct.toFixed(1)}% of days`);
    console.log(`\nSpread best-worst: ${fmt(bestByAvg.avgRel - worstByAvg.avgRel)}% (this is the theoretical max edge from perfect hour-timing, before fees/slippage)\n`);
  })();
}

const symbol = process.argv[2] ?? 'BTCUSDT';
const days = Number(process.argv[3] ?? 1095);
main2(symbol, days).catch((e) => {
  console.error(e);
  process.exit(1);
});
