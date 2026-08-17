/**
 * BTC monthly seasonality table (the "Bitcoin Monthly Returns %" grid on coinglass.com/today,
 * rebuilt from raw exchange data so every number is reproducible).
 *
 * Data:
 *   - Bitstamp BTC/USD daily OHLC (public, no auth) from 2012-01-01 — the longest clean series.
 *   - Monthly candle = first day's open, last day's close, max high, min low of that calendar month.
 *
 * Output:
 *   1. year x month return matrix (%)
 *   2. per-calendar-month stats: mean, median, win rate, best, worst — full history AND 2017+
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-btc-monthly-seasonality.ts [startYear]
 */
import * as https from 'https';

const START_YEAR = Number(process.argv[2] ?? 2012);
const BITSTAMP = 'https://www.bitstamp.net/api/v2/ohlc/btcusd/';

type Day = { ts: number; open: number; high: number; low: number; close: number };

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'node' } }, (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(d));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

async function fetchDaily(startSec: number, endSec: number): Promise<Day[]> {
  const out: Day[] = [];
  let cur = startSec;
  while (cur < endSec) {
    // NOTE: passing `end` makes Bitstamp return the LAST `limit` candles of the range,
    // so page forward with `start` only.
    const url = `${BITSTAMP}?step=86400&limit=1000&start=${cur}`;
    const res = await fetchJson(url);
    const rows: any[] = res?.data?.ohlc ?? [];
    if (rows.length === 0) break;
    for (const r of rows) {
      const ts = Number(r.timestamp);
      if (out.length && ts <= out[out.length - 1].ts) continue;
      out.push({
        ts,
        open: parseFloat(r.open),
        high: parseFloat(r.high),
        low: parseFloat(r.low),
        close: parseFloat(r.close),
      });
    }
    const last = out[out.length - 1].ts;
    if (last <= cur) break;
    cur = last + 86400;
  }
  return out;
}

type Month = { y: number; m: number; open: number; high: number; low: number; close: number };

function toMonthly(days: Day[]): Month[] {
  const map = new Map<string, Month>();
  for (const d of days) {
    const dt = new Date(d.ts * 1000);
    const y = dt.getUTCFullYear();
    const m = dt.getUTCMonth() + 1;
    const key = `${y}-${m}`;
    const cur = map.get(key);
    if (!cur) {
      map.set(key, { y, m, open: d.open, high: d.high, low: d.low, close: d.close });
    } else {
      cur.high = Math.max(cur.high, d.high);
      cur.low = Math.min(cur.low, d.low);
      cur.close = d.close;
    }
  }
  return [...map.values()].sort((a, b) => a.y - b.y || a.m - b.m);
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const median = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  const wins = xs.filter((x) => x > 0).length;
  return { n: xs.length, mean, median, win: (wins / xs.length) * 100, best: s[s.length - 1], worst: s[0] };
}

function pad(s: string, n: number) {
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

async function main() {
  const startSec = Math.floor(Date.UTC(START_YEAR, 0, 1) / 1000);
  const endSec = Math.floor(Date.now() / 1000);
  const days = await fetchDaily(startSec, endSec);
  const months = toMonthly(days);

  // month-over-month return = (close - open) / open of the calendar month
  const rows = months.map((mo) => ({ ...mo, ret: ((mo.close - mo.open) / mo.open) * 100 }));

  console.log(`\nBTC/USD (Bitstamp) — ${rows[0].y}-${rows[0].m} → ${rows[rows.length - 1].y}-${rows[rows.length - 1].m}`);
  console.log(`daily candles: ${days.length}, months: ${rows.length}\n`);

  // --- matrix ---
  const years = [...new Set(rows.map((r) => r.y))];
  console.log('=== Monthly returns (%) ===');
  console.log(pad('year', 5) + MONTH_NAMES.map((m) => pad(m, 8)).join('') + pad('YEAR', 9));
  for (const y of years) {
    const cells: string[] = [];
    for (let m = 1; m <= 12; m++) {
      const r = rows.find((x) => x.y === y && x.m === m);
      cells.push(pad(r ? r.ret.toFixed(1) : '-', 8));
    }
    const inYear = rows.filter((x) => x.y === y);
    const yr = inYear.length ? ((inYear[inYear.length - 1].close - inYear[0].open) / inYear[0].open) * 100 : NaN;
    console.log(pad(String(y), 5) + cells.join('') + pad(isNaN(yr) ? '-' : yr.toFixed(1), 9));
  }

  for (const [label, from] of [
    ['FULL HISTORY', START_YEAR],
    ['2017+', 2017],
    ['2020+', 2020],
  ] as [string, number][]) {
    console.log(`\n=== Per-month stats — ${label} ===`);
    console.log(
      pad('month', 6) + pad('n', 4) + pad('mean%', 9) + pad('median%', 9) + pad('win%', 8) + pad('best%', 9) + pad('worst%', 9),
    );
    const summary: { m: number; mean: number; median: number; win: number }[] = [];
    for (let m = 1; m <= 12; m++) {
      const xs = rows.filter((r) => r.m === m && r.y >= from).map((r) => r.ret);
      if (!xs.length) continue;
      const s = stats(xs);
      summary.push({ m, mean: s.mean, median: s.median, win: s.win });
      console.log(
        pad(MONTH_NAMES[m - 1], 6) +
          pad(String(s.n), 4) +
          pad(s.mean.toFixed(2), 9) +
          pad(s.median.toFixed(2), 9) +
          pad(s.win.toFixed(0), 8) +
          pad(s.best.toFixed(1), 9) +
          pad(s.worst.toFixed(1), 9),
      );
    }
    const byMean = [...summary].sort((a, b) => b.mean - a.mean);
    console.log(
      `  best-by-mean : ${byMean.slice(0, 4).map((x) => `${MONTH_NAMES[x.m - 1]} ${x.mean.toFixed(1)}%`).join(', ')}`,
    );
    console.log(
      `  worst-by-mean: ${byMean.slice(-4).map((x) => `${MONTH_NAMES[x.m - 1]} ${x.mean.toFixed(1)}%`).join(', ')}`,
    );
    const byMed = [...summary].sort((a, b) => b.median - a.median);
    console.log(
      `  best-by-median : ${byMed.slice(0, 4).map((x) => `${MONTH_NAMES[x.m - 1]} ${x.median.toFixed(1)}%`).join(', ')}`,
    );
    console.log(
      `  worst-by-median: ${byMed.slice(-4).map((x) => `${MONTH_NAMES[x.m - 1]} ${x.median.toFixed(1)}%`).join(', ')}`,
    );
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
