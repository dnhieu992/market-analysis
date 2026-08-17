/**
 * BTC "yearly DCA reset" — the plan:
 *
 *   "Every day of the year I buy $10 of BTC, starting on 1 Jan.
 *    On the last day of the year I sell the whole bag. Repeat next year."
 *
 * Each calendar year is an independent cycle: fixed $10/day (NOT compounded — the
 * profit is taken out at year end, next year starts fresh at $10/day), buys fill at
 * the daily OPEN, the year-end sell fills at the last daily CLOSE of that year.
 * Spot, no leverage, no stop-loss, fee charged on both sides.
 *
 * The current (incomplete) year is marked to market at the latest close.
 *
 * Also prints two benchmarks over the same window:
 *   - HODL DCA  : same $10/day but never sell (one bag from 2021 to today)
 *   - Lump sum  : the same total capital invested on day 1 and held
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-btc-yearly-dca-10usd.ts [startDate] [dailyUsd] [feePctPerSide]
 */
import * as https from 'https';

const START = process.argv[2] ?? '2021-01-01';
const DAILY = Number(process.argv[3] ?? 10);
const FEE = Number(process.argv[4] ?? 0.05) / 100;

const BITSTAMP = 'https://www.bitstamp.net/api/v2/ohlc/btcusd/';

type Day = { ts: number; date: string; y: number; open: number; high: number; low: number; close: number };

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'node' } }, (res) => {
        let s = '';
        res.on('data', (c) => (s += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(s));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

async function fetchDaily(startSec: number): Promise<Day[]> {
  const out: Day[] = [];
  let cur = startSec;
  for (;;) {
    const res = await fetchJson(`${BITSTAMP}?step=86400&limit=1000&start=${cur}`);
    const rows: any[] = res?.data?.ohlc ?? [];
    if (!rows.length) break;
    let added = 0;
    for (const r of rows) {
      const ts = Number(r.timestamp);
      if (out.length && ts <= out[out.length - 1].ts) continue;
      const dt = new Date(ts * 1000);
      out.push({
        ts,
        date: dt.toISOString().slice(0, 10),
        y: dt.getUTCFullYear(),
        open: parseFloat(r.open),
        high: parseFloat(r.high),
        low: parseFloat(r.low),
        close: parseFloat(r.close),
      });
      added++;
    }
    if (!added) break;
    cur = out[out.length - 1].ts + 86400;
  }
  return out;
}

function pad(s: string, n: number) {
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}
function money(v: number, dp = 0) {
  return (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(dp);
}

type YearResult = {
  year: number;
  from: string;
  to: string;
  days: number;
  invested: number;
  coins: number;
  avgCost: number;
  exitPrice: number;
  proceeds: number;
  pl: number;
  roi: number;
  fees: number;
  bhRoi: number; // buy & hold the same year (open of 1st day -> close of last day)
  worstMtm: number; // deepest unrealised loss on the bag vs money put in, at the daily low
  peakMtm: number; // best unrealised gain seen at a daily high
  open: boolean;
};

function runYear(days: Day[], open: boolean): YearResult {
  let coins = 0;
  let invested = 0;
  let fees = 0;
  let worstMtm = 0;
  let peakMtm = 0;

  for (const d of days) {
    const gross = DAILY;
    fees += gross * FEE;
    coins += (gross * (1 - FEE)) / d.open;
    invested += gross;
    const lo = (coins * d.low - invested) / invested;
    const hi = (coins * d.high - invested) / invested;
    if (lo < worstMtm) worstMtm = lo;
    if (hi > peakMtm) peakMtm = hi;
  }

  const last = days[days.length - 1];
  const exitPrice = last.close;
  const proceeds = coins * exitPrice * (1 - FEE);
  fees += coins * exitPrice * FEE;

  return {
    year: days[0].y,
    from: days[0].date,
    to: last.date,
    days: days.length,
    invested,
    coins,
    avgCost: invested / coins,
    exitPrice,
    proceeds,
    pl: proceeds - invested,
    roi: ((proceeds - invested) / invested) * 100,
    fees,
    bhRoi: ((last.close - days[0].open) / days[0].open) * 100,
    worstMtm: worstMtm * 100,
    peakMtm: peakMtm * 100,
    open,
  };
}

async function main() {
  const startSec = Math.floor(new Date(START + 'T00:00:00Z').getTime() / 1000);
  const all = await fetchDaily(startSec);
  const days = all.filter((d) => d.date >= START);
  const first = days[0];
  const last = days[days.length - 1];
  const lastYear = last.y;

  const years = [...new Set(days.map((d) => d.y))].sort();
  const results = years.map((y) => runYear(days.filter((d) => d.y === y), y === lastYear));

  console.log(`\nBTC/USD (Bitstamp daily) ${first.date} → ${last.date}`);
  console.log(
    `strategy: buy ${money(DAILY)} at every daily OPEN from 1 Jan, SELL EVERYTHING at the last daily CLOSE of the year`,
  );
  console.log(`fee ${(FEE * 100).toFixed(3)}%/side · spot · not compounded (profit withdrawn each year)\n`);

  console.log('=== Per-year result ===');
  console.log(
    pad('year', 6) +
      pad('days', 6) +
      pad('invested', 10) +
      pad('avg cost', 10) +
      pad('exit px', 10) +
      pad('proceeds', 11) +
      pad('P/L', 11) +
      pad('ROI%', 9) +
      pad('B&H%', 9) +
      pad('worstMtm', 10) +
      pad('peakMtm', 10),
  );
  for (const r of results) {
    console.log(
      pad(String(r.year) + (r.open ? '*' : ''), 6) +
        pad(String(r.days), 6) +
        pad(money(r.invested), 10) +
        pad(r.avgCost.toFixed(0), 10) +
        pad(r.exitPrice.toFixed(0), 10) +
        pad(money(r.proceeds), 11) +
        pad((r.pl >= 0 ? '+' : '') + money(r.pl), 11) +
        pad((r.roi >= 0 ? '+' : '') + r.roi.toFixed(1), 9) +
        pad((r.bhRoi >= 0 ? '+' : '') + r.bhRoi.toFixed(1), 9) +
        pad(r.worstMtm.toFixed(1), 10) +
        pad('+' + r.peakMtm.toFixed(1), 10),
    );
  }

  const totInv = results.reduce((a, r) => a + r.invested, 0);
  const totPl = results.reduce((a, r) => a + r.pl, 0);
  const totFee = results.reduce((a, r) => a + r.fees, 0);
  const wins = results.filter((r) => r.pl > 0).length;
  console.log(
    `\nTOTAL  invested ${money(totInv)} · P/L ${(totPl >= 0 ? '+' : '') + money(totPl)} ` +
      `(${((totPl / totInv) * 100).toFixed(1)}% on money deployed) · fees ${money(totFee)} · ` +
      `winning years ${wins}/${results.length}`,
  );
  console.log(`* ${lastYear} is incomplete — marked to market at the ${last.date} close.`);

  // --- benchmark 1: same daily $10 but never sell -------------------------------
  let coins = 0;
  let invested = 0;
  let feesH = 0;
  for (const d of days) {
    feesH += DAILY * FEE;
    coins += (DAILY * (1 - FEE)) / d.open;
    invested += DAILY;
  }
  const hodlValue = coins * last.close * (1 - FEE);

  // --- benchmark 2: the same total capital, all in on day 1 ---------------------
  const lumpCoins = (invested * (1 - FEE)) / first.open;
  const lumpValue = lumpCoins * last.close * (1 - FEE);

  console.log('\n=== Benchmarks over the same window (same total money) ===');
  console.log(
    pad('strategy', 26) + pad('invested', 11) + pad('value/out', 12) + pad('P/L', 12) + pad('ROI%', 9),
  );
  const bline = (label: string, inv: number, val: number) =>
    console.log(
      pad(label, 26) +
        pad(money(inv), 11) +
        pad(money(val), 12) +
        pad((val - inv >= 0 ? '+' : '') + money(val - inv), 12) +
        pad((((val - inv) / inv) * 100).toFixed(1), 9),
    );
  bline(`DCA ${money(DAILY)}/d, sell each year`, totInv, totInv + totPl);
  bline(`DCA ${money(DAILY)}/d, never sell`, invested, hodlValue);
  bline('Lump sum day 1, never sell', invested, lumpValue);
  console.log(`\n(BTC ${first.date} open ${first.open.toFixed(0)} → ${last.date} close ${last.close.toFixed(0)})\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
