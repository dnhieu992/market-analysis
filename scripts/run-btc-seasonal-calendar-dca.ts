/**
 * BTC seasonal calendar DCA — the plan a human can actually follow:
 *
 *   "Every year I only buy BTC on the 1st of these calendar months (the historically weak ones),
 *    one tranche each. Whenever the bag is +X% over my average cost, I sell all of it and wait
 *    for the next scheduled buy month."
 *
 * Capital is compounded: each tranche = currentCapital / tranchesPerCycle, so realised profit
 * rolls into the next buys. No stop-loss, spot, fee both sides. TP fills on the daily HIGH
 * touching avgCost x (1 + tp) — a resting limit sell.
 *
 * Sweeps buy-month sets x TP levels and prints the equity result, the wait-time distribution
 * and the worst unrealised drawdown, against a buy & hold benchmark.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-btc-seasonal-calendar-dca.ts [startDate] [capital] [feePctPerSide] [detailKey]
 *
 *   detailKey (optional) prints the trade-by-trade log for one config, e.g. "May/Jun/Aug|8"
 */
import * as https from 'https';

const START = process.argv[2] ?? '2022-01-01';
const CAPITAL = Number(process.argv[3] ?? 2000);
const FEE = Number(process.argv[4] ?? 0.05) / 100;
const DETAIL = process.argv[5] ?? '';
const END = process.argv[6] ?? '2100-01-01';

const BITSTAMP = 'https://www.bitstamp.net/api/v2/ohlc/btcusd/';
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type Day = { ts: number; date: string; y: number; m: number; d: number; open: number; high: number; low: number; close: number };

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
        m: dt.getUTCMonth() + 1,
        d: dt.getUTCDate(),
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

type Ev = { kind: 'BUY' | 'SELL'; date: string; price: number; usd: number; avgCost?: number; buys?: number; heldDays?: number; profit?: number };

function run(days: Day[], buyMonths: number[], tp: number, div?: number, log?: Ev[]) {
  const tpx = tp / 100;
  // tranche = capital / div. Default: one tranche per scheduled buy month (full deployment
  // only if every scheduled month of the year fires inside the same cycle).
  const n = div ?? buyMonths.length;
  let cash = CAPITAL;
  let coins = 0;
  let invested = 0;
  let buys = 0;
  let cycleStart: string | null = null;
  let lastMonth = -1;
  let worstMtm = 0;
  const waits: number[] = [];
  const profits: number[] = [];
  let cycleStartTs = 0;
  let peakEquity = CAPITAL;
  let maxDd = 0; // max drawdown of TOTAL equity (cash + bag marked at the daily low)

  for (const day of days) {
    const mk = day.y * 12 + day.m;
    if (day.d === 1 && mk !== lastMonth && buyMonths.includes(day.m)) {
      lastMonth = mk;
      const size = Math.min(cash, (cash + invested) / n);
      if (size > 1) {
        coins += (size * (1 - FEE)) / day.open;
        cash -= size;
        invested += size;
        buys++;
        if (!cycleStart) {
          cycleStart = day.date;
          cycleStartTs = day.ts;
        }
        log?.push({ kind: 'BUY', date: day.date, price: day.open, usd: size, avgCost: invested / coins, buys });
      }
    }
    if (cash + coins * day.high > peakEquity) peakEquity = cash + coins * day.high;
    const dd = (cash + coins * day.low - peakEquity) / peakEquity;
    if (dd < maxDd) maxDd = dd;

    if (coins <= 0) continue;
    const avgCost = invested / coins;
    const mtm = (coins * day.low - invested) / invested;
    if (mtm < worstMtm) worstMtm = mtm;
    const target = avgCost * (1 + tpx);
    if (day.high >= target) {
      const proceeds = coins * target * (1 - FEE);
      const profit = proceeds - invested;
      cash += proceeds;
      log?.push({
        kind: 'SELL',
        date: day.date,
        price: target,
        usd: proceeds,
        avgCost,
        buys,
        heldDays: Math.round((day.ts - cycleStartTs) / 86400),
        profit,
      });
      waits.push(Math.round((day.ts - cycleStartTs) / 86400));
      profits.push(profit);
      coins = 0;
      invested = 0;
      buys = 0;
      cycleStart = null;
    }
  }

  const last = days[days.length - 1];
  const openValue = coins * last.close * (1 - FEE);
  const equity = cash + openValue;
  const openPl = coins > 0 ? openValue - invested : 0;
  const years = (last.ts - days[0].ts) / 86400 / 365.25;
  return {
    equity,
    ret: ((equity - CAPITAL) / CAPITAL) * 100,
    annual: (Math.pow(equity / CAPITAL, 1 / years) - 1) * 100,
    trades: waits.length,
    realised: profits.reduce((a, b) => a + b, 0),
    openPl,
    openInvested: invested,
    openDays: cycleStart ? Math.round((last.ts - cycleStartTs) / 86400) : 0,
    medWait: waits.length ? [...waits].sort((a, b) => a - b)[Math.floor(waits.length / 2)] : NaN,
    maxWait: waits.length ? Math.max(...waits) : NaN,
    worstMtm: worstMtm * 100,
    maxDd: maxDd * 100,
  };
}

/** Max drawdown of a pure buy & hold position over the same window. */
function bhMaxDd(days: Day[]): number {
  let peak = 0;
  let dd = 0;
  for (const d of days) {
    if (d.high > peak) peak = d.high;
    const cur = (d.low - peak) / peak;
    if (cur < dd) dd = cur;
  }
  return dd * 100;
}

function pad(s: string, n: number) {
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

const SETS: [string, number[]][] = [
  ['all 12 months', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]],
  ['Jun/Aug', [6, 8]],
  ['May/Jun/Aug', [5, 6, 8]],
  ['Apr/May/Jun/Aug', [4, 5, 6, 8]],
  ['May/Jun/Aug/Dec', [5, 6, 8, 12]],
  ['Apr..Aug (5)', [4, 5, 6, 7, 8]],
  ['Jan/May/Jun/Aug', [1, 5, 6, 8]],
  ['Jun/Aug/Nov/Dec', [6, 8, 11, 12]],
  ['May/Jun/Aug/Sep', [5, 6, 8, 9]],
];
const TPS = [5, 6, 8, 10, 12];

async function main() {
  const startSec = Math.floor(new Date(START + 'T00:00:00Z').getTime() / 1000);
  const all = await fetchDaily(startSec);
  const days = all.filter((d) => d.date >= START && d.date < END);
  const first = days[0];
  const last = days[days.length - 1];
  const years = (last.ts - first.ts) / 86400 / 365.25;
  const bh = (CAPITAL * (1 - FEE) * last.close) / first.open;

  console.log(`\nBTC/USD (Bitstamp daily) ${first.date} → ${last.date}  (${years.toFixed(2)}y)`);
  console.log(`capital $${CAPITAL} compounded · fee ${(FEE * 100).toFixed(3)}%/side · TP on daily HIGH touch`);
  console.log(`BUY & HOLD: $${bh.toFixed(0)}  (${(((bh - CAPITAL) / CAPITAL) * 100).toFixed(1)}%, ${((Math.pow(bh / CAPITAL, 1 / years) - 1) * 100).toFixed(1)}%/yr, maxDD ${bhMaxDd(days).toFixed(1)}%)\n`);

  const header =
    pad('buy months', 18) +
    pad('div', 5) +
    pad('TP%', 5) +
    pad('equity', 10) +
    pad('total%', 9) +
    pad('%/yr', 8) +
    pad('trades', 8) +
    pad('realised', 10) +
    pad('open P/L', 10) +
    pad('med d', 7) +
    pad('max d', 7) +
    pad('eqMaxDD', 9);
  const line = (label: string, div: number, tp: number, r: ReturnType<typeof run>) =>
    pad(label, 18) +
      pad(String(div), 5) +
      pad(String(tp), 5) +
      pad('$' + r.equity.toFixed(0), 10) +
      pad(r.ret.toFixed(1), 9) +
      pad(r.annual.toFixed(1), 8) +
      pad(String(r.trades), 8) +
      pad('+$' + r.realised.toFixed(0), 10) +
      pad((r.openPl >= 0 ? '+$' : '-$') + Math.abs(r.openPl).toFixed(0), 10) +
      pad(String(r.medWait), 7) +
      pad(String(r.maxWait), 7) +
      pad(r.maxDd.toFixed(1), 9);

  console.log('=== 1. Buy-month set x TP (tranche = capital / number of buy months) ===');
  console.log(header);
  for (const [label, months] of SETS) {
    for (const tp of TPS) console.log(line(label, months.length, tp, run(days, months, tp)));
    console.log('');
  }

  console.log('=== 2. Tranche-size sweep on the leading sets ===');
  console.log(header);
  for (const label of ['May/Jun/Aug/Sep', 'Apr..Aug (5)', 'May/Jun/Aug/Dec', 'all 12 months']) {
    const months = SETS.find((s) => s[0] === label)![1];
    for (const div of [2, 3, 4]) {
      for (const tp of [5, 6, 8, 10]) console.log(line(label, div, tp, run(days, months, tp, div)));
    }
    console.log('');
  }

  if (DETAIL) {
    const [label, tpStr, divStr] = DETAIL.split('|');
    const set = SETS.find((s) => s[0] === label);
    if (set) {
      const log: Ev[] = [];
      const r = run(days, set[1], Number(tpStr), divStr ? Number(divStr) : undefined, log);
      console.log(`=== Trade log — ${label} · TP ${tpStr}% ===`);
      console.log(pad('type', 6) + pad('date', 12) + pad('price', 10) + pad('usd', 10) + pad('avgCost', 10) + pad('#buys', 7) + pad('held', 6) + pad('profit', 10));
      for (const e of log) {
        console.log(
          pad(e.kind, 6) +
            pad(e.date, 12) +
            pad(e.price.toFixed(0), 10) +
            pad('$' + e.usd.toFixed(0), 10) +
            pad(e.avgCost ? e.avgCost.toFixed(0) : '-', 10) +
            pad(String(e.buys ?? '-'), 7) +
            pad(e.heldDays !== undefined ? String(e.heldDays) : '-', 6) +
            pad(e.profit !== undefined ? (e.profit >= 0 ? '+$' : '-$') + Math.abs(e.profit).toFixed(0) : '-', 10),
        );
      }
      console.log(`\nfinal equity $${r.equity.toFixed(0)} · open bag $${r.openInvested.toFixed(0)} for ${r.openDays}d (${r.openPl >= 0 ? '+' : ''}$${r.openPl.toFixed(0)})`);
    }
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
