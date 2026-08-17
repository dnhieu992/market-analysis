/**
 * BTC lot-grid — robustness table for a shortlist of configs.
 *
 * Companion to scripts/run-btc-lot-grid-backtest.ts (same engine, same rules: each lot sells at
 * its OWN entry x (1 + sellPct); buy one lot every `buyPct` below the running high since the last buy).
 *
 * The sweep script answers "which cell is biggest". This one answers the question that actually
 * decides whether a config is usable: does it survive BOTH market regimes AND both fill models?
 *
 *   regimes    2022-01-01 → today (sideways/chop)  vs  2017-01-01 → 2021-12-31 (bull)
 *   fill model `touch` = real resting limit orders on the exchange
 *              `close` = you check once a day by hand, at most one buy and one sell per day
 *
 * A config that only works in `touch` is a config that only works if the orders really are sitting
 * on the book. A config that only works in one regime is curve-fitted.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-btc-lot-grid-robustness.ts [capital] [feePctPerSide]
 */
import * as https from 'https';

const CAPITAL = Number(process.argv[2] ?? 2000);
const FEE = Number(process.argv[3] ?? 0.05) / 100;
const BITSTAMP = 'https://www.bitstamp.net/api/v2/ohlc/btcusd/';

type Day = { ts: number; date: string; open: number; high: number; low: number; close: number };
type Mode = 'touch' | 'close';

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
      out.push({
        ts,
        date: new Date(ts * 1000).toISOString().slice(0, 10),
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

type Lot = { ts: number; price: number; coins: number; cost: number };

function run(days: Day[], buyPct: number, sellPct: number, maxLots: number, mode: Mode) {
  const bx = buyPct / 100;
  const sx = sellPct / 100;
  const lotUsd = CAPITAL / maxLots;

  let cash = CAPITAL;
  const lots: Lot[] = [];
  let ref = days[0].open;
  let realised = 0;
  let flips = 0;
  let peak = CAPITAL;
  let maxDd = 0;
  let daysFullyLoaded = 0;
  let oldestOpen = 0;
  let maxDeployed = 0;

  const buyOne = (price: number, ts: number) => {
    if (lots.length >= maxLots || cash < lotUsd) return false;
    lots.push({ ts, price, coins: (lotUsd * (1 - FEE)) / price, cost: lotUsd });
    cash -= lotUsd;
    ref = price;
    return true;
  };

  for (const day of days) {
    if (mode === 'touch') {
      if (day.high > ref) ref = day.high;
      for (;;) {
        const trigger = ref * (1 - bx);
        if (day.low > trigger) break;
        if (!buyOne(day.open < trigger ? day.open : trigger, day.ts)) break;
      }
    } else {
      if (day.close > ref) ref = day.close;
      if (day.close <= ref * (1 - bx)) buyOne(day.close, day.ts);
    }

    for (let i = lots.length - 1; i >= 0; i--) {
      const lot = lots[i];
      if (lot.ts >= day.ts) continue; // no same-day flip
      const target = lot.price * (1 + sx);
      const hit = mode === 'touch' ? day.high >= target : day.close >= target;
      if (!hit) continue;
      const fillPx = mode === 'touch' ? target : day.close;
      const proceeds = lot.coins * fillPx * (1 - FEE);
      cash += proceeds;
      realised += proceeds - lot.cost;
      flips++;
      lots.splice(i, 1);
    }

    const coins = lots.reduce((a, l) => a + l.coins, 0);
    const deployed = lots.reduce((a, l) => a + l.cost, 0);
    if (deployed > maxDeployed) maxDeployed = deployed;
    if (lots.length >= maxLots) daysFullyLoaded++;
    if (lots.length) {
      const age = Math.round((day.ts - lots[0].ts) / 86400);
      if (age > oldestOpen) oldestOpen = age;
    }
    const eqHigh = cash + coins * day.high;
    if (eqHigh > peak) peak = eqHigh;
    const dd = (cash + coins * day.low - peak) / peak;
    if (dd < maxDd) maxDd = dd;
  }

  const last = days[days.length - 1];
  const coins = lots.reduce((a, l) => a + l.coins, 0);
  const equity = cash + coins * last.close * (1 - FEE);
  const years = (last.ts - days[0].ts) / 86400 / 365.25;
  return {
    ret: ((equity - CAPITAL) / CAPITAL) * 100,
    annual: (Math.pow(equity / CAPITAL, 1 / years) - 1) * 100,
    flips,
    realised,
    maxDeployed,
    pctFull: (daysFullyLoaded / days.length) * 100,
    oldestOpen,
    maxDd: maxDd * 100,
  };
}

function bh(days: Day[]) {
  const eq = (CAPITAL * (1 - FEE) * days[days.length - 1].close) / days[0].open;
  let peak = 0;
  let dd = 0;
  for (const d of days) {
    if (d.high > peak) peak = d.high;
    const c = (d.low - peak) / peak;
    if (c < dd) dd = c;
  }
  return { ret: ((eq - CAPITAL) / CAPITAL) * 100, maxDd: dd * 100 };
}

function pad(s: string, n: number) {
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

// buyPct, sellPct, maxLots
const SHORTLIST: [number, number, number][] = [
  [3, 5, 10],
  [3, 5, 20],
  [3, 5, 30],
  [3, 7, 20],
  [5, 5, 20],
  [5, 5, 30],
  [5, 7, 20],
  [5, 7, 30],
  [5, 7, 40],
  [5, 10, 10],
  [5, 10, 20],
  [5, 10, 30],
  [7, 10, 20],
  [7, 10, 40],
];

async function main() {
  const all = await fetchDaily(Math.floor(new Date('2017-01-01T00:00:00Z').getTime() / 1000));
  const chop = all.filter((d) => d.date >= '2022-01-01');
  const bull = all.filter((d) => d.date >= '2017-01-01' && d.date < '2022-01-01');

  console.log(`\nBTC/USD (Bitstamp daily) · $${CAPITAL} · fee ${(FEE * 100).toFixed(3)}%/side · no same-day flip`);
  console.log(`CHOP  ${chop[0].date} → ${chop[chop.length - 1].date}   B&H ${bh(chop).ret.toFixed(1)}%  (maxDD ${bh(chop).maxDd.toFixed(1)}%)`);
  console.log(`BULL  ${bull[0].date} → ${bull[bull.length - 1].date}   B&H ${bh(bull).ret.toFixed(1)}%  (maxDD ${bh(bull).maxDd.toFixed(1)}%)\n`);

  const header =
    pad('X/Y/lots', 12) +
    pad('lot$', 7) +
    '  |' +
    pad('chop touch', 12) +
    pad('DD', 8) +
    pad('chop close', 12) +
    pad('DD', 8) +
    '  |' +
    pad('bull touch', 12) +
    pad('DD', 8) +
    pad('bull close', 12) +
    pad('DD', 8) +
    '  |' +
    pad('WORST', 9) +
    pad('flips/y', 9) +
    pad('oldest', 8);
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const [x, y, n] of SHORTLIST) {
    const ct = run(chop, x, y, n, 'touch');
    const cc = run(chop, x, y, n, 'close');
    const bt = run(bull, x, y, n, 'touch');
    const bc = run(bull, x, y, n, 'close');
    // annualised, so the two windows are comparable; the weakest of the four is what you must live with
    const worst = Math.min(ct.annual, cc.annual, bt.annual, bc.annual);
    console.log(
      pad(`${x}/${y}/${n}`, 12) +
        pad('$' + (CAPITAL / n).toFixed(0), 7) +
        '  |' +
        pad(ct.ret.toFixed(1) + '%', 12) +
        pad(ct.maxDd.toFixed(0), 8) +
        pad(cc.ret.toFixed(1) + '%', 12) +
        pad(cc.maxDd.toFixed(0), 8) +
        '  |' +
        pad(bt.ret.toFixed(1) + '%', 12) +
        pad(bt.maxDd.toFixed(0), 8) +
        pad(bc.ret.toFixed(1) + '%', 12) +
        pad(bc.maxDd.toFixed(0), 8) +
        '  |' +
        pad(worst.toFixed(1) + '%/y', 9) +
        pad((ct.flips / 4.6).toFixed(0), 9) +
        pad(String(Math.max(ct.oldestOpen, bt.oldestOpen)), 8),
    );
  }
  console.log('\nWORST = the weakest annualised return of the four cells. Pick on this, not on the best cell.');
  console.log('flips/y = round trips per year in the chop window (touch) — your actual workload.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
