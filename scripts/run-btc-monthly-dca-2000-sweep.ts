/**
 * Sweep for the "$2,000 monthly BTC DCA, take profit at +X% over average cost" plan.
 *
 * One cycle:
 *   - buy `budget / tranches` at the OPEN on the 1st of the month;
 *   - repeat every month until all tranches are deployed (optionally only when price is
 *     BELOW the current average cost — the dip-gate);
 *   - sell the whole bag the day the HIGH touches avgCost x (1 + tp);
 *   - restart on the 1st of the NEXT month with the full budget again.
 *   - no stop-loss, spot, fee both sides.
 *
 * Swept: number of tranches (1 = lump sum ... 12 = a full year of DCA) x take-profit level,
 * with and without the dip-gate. Reports realised P/L, how long you wait, how deep the bag
 * goes under water, and annualised return on the WHOLE $2,000 (idle capital included) so the
 * numbers are comparable to buy & hold.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-btc-monthly-dca-2000-sweep.ts [startDate] [budget] [feePctPerSide]
 */
import * as https from 'https';

const START = process.argv[2] ?? '2017-01-01';
const BUDGET = Number(process.argv[3] ?? 2000);
const FEE = Number(process.argv[4] ?? 0.05) / 100;

const BITSTAMP = 'https://www.bitstamp.net/api/v2/ohlc/btcusd/';
const TRANCHES = [1, 2, 3, 4, 6, 12];
const TPS = [5, 8, 10, 15];

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

type Cycle = { start: string; end: string | null; days: number; buys: number; invested: number; avgCost: number; exit: number | null; profit: number; worst: number };

type Opts = { tranches: number; tp: number; dipGate: boolean; startMonths?: number[] };

function runCycles(days: Day[], o: Opts): Cycle[] {
  const size = BUDGET / o.tranches;
  const tp = o.tp / 100;
  const cycles: Cycle[] = [];
  let i = 0;
  while (i < days.length) {
    while (i < days.length && !(days[i].d === 1 && (!o.startMonths || o.startMonths.includes(days[i].m)))) i++;
    if (i >= days.length) break;

    let invested = 0;
    let coins = 0;
    let buys = 0;
    let worst = 0;
    let lastMonth = -1;
    const startDate = days[i].date;
    let closed = false;
    let j = i;

    for (; j < days.length; j++) {
      const day = days[j];
      const mk = day.y * 12 + day.m;
      if (day.d === 1 && mk !== lastMonth && buys < o.tranches) {
        const avg = coins > 0 ? invested / coins : Infinity;
        const allowed = buys === 0 || !o.dipGate || day.open < avg;
        if (allowed) {
          coins += (size * (1 - FEE)) / day.open;
          invested += size;
          buys++;
          lastMonth = mk;
        }
      }
      if (coins <= 0) continue;
      const avgCost = invested / coins;
      const mtm = (coins * day.low - invested) / invested;
      if (mtm < worst) worst = mtm;
      const target = avgCost * (1 + tp);
      if (day.high >= target) {
        cycles.push({
          start: startDate,
          end: day.date,
          days: Math.round((day.ts - days[i].ts) / 86400),
          buys,
          invested,
          avgCost,
          exit: target,
          profit: coins * target * (1 - FEE) - invested,
          worst: worst * 100,
        });
        closed = true;
        break;
      }
    }
    if (!closed) {
      const last = days[days.length - 1];
      cycles.push({
        start: startDate,
        end: null,
        days: Math.round((last.ts - days[i].ts) / 86400),
        buys,
        invested,
        avgCost: coins > 0 ? invested / coins : 0,
        exit: null,
        profit: coins * last.close * (1 - FEE) - invested,
        worst: worst * 100,
      });
      break;
    }
    const endDay = days[j];
    let k = j;
    while (k < days.length && !(days[k].d === 1 && days[k].y * 12 + days[k].m > endDay.y * 12 + endDay.m && (!o.startMonths || o.startMonths.includes(days[k].m)))) k++;
    i = k;
  }
  return cycles;
}

function pctile(xs: number[], p: number) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
function pad(s: string, n: number) {
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

function summarize(days: Day[], cycles: Cycle[], years: number) {
  const closed = cycles.filter((c) => c.end);
  const ds = closed.map((c) => c.days);
  const realised = closed.reduce((a, c) => a + c.profit, 0);
  const open = cycles.find((c) => !c.end);
  const openPl = open ? open.profit : 0;
  const total = realised + openPl;
  const timeIn = cycles.reduce((a, c) => a + c.days, 0);
  const span = (days[days.length - 1].ts - days[0].ts) / 86400;
  return {
    n: cycles.length,
    closed: closed.length,
    med: ds.length ? pctile(ds, 50) : NaN,
    p90: ds.length ? pctile(ds, 90) : NaN,
    max: ds.length ? Math.max(...ds) : NaN,
    realised,
    openPl,
    total,
    worst: Math.min(...cycles.map((c) => c.worst)),
    annual: (Math.pow(1 + total / BUDGET, 1 / years) - 1) * 100,
    inMarket: (timeIn / span) * 100,
    openInfo: open ? `${open.start}→ ${open.days}d $${open.invested.toFixed(0)}` : '-',
  };
}

async function main() {
  const startSec = Math.floor(new Date(START + 'T00:00:00Z').getTime() / 1000);
  const all = await fetchDaily(startSec);
  const days = all.filter((d) => d.date >= START);
  const years = (days[days.length - 1].ts - days[0].ts) / 86400 / 365.25;

  const first = days[0];
  const last = days[days.length - 1];
  const bh = (BUDGET * (1 - FEE) * last.close) / first.open;
  console.log(`\nBTC/USD (Bitstamp daily) ${first.date} → ${last.date}  (${days.length} days, ${years.toFixed(2)}y)`);
  console.log(`open ${first.open.toFixed(0)} → close ${last.close.toFixed(0)}  ·  budget $${BUDGET}  ·  fee ${(FEE * 100).toFixed(3)}%/side`);
  console.log(
    `BUY & HOLD benchmark: $${BUDGET} → $${bh.toFixed(0)}  (${(((bh - BUDGET) / BUDGET) * 100).toFixed(0)}%, ${((Math.pow(bh / BUDGET, 1 / years) - 1) * 100).toFixed(1)}%/yr)\n`,
  );

  for (const dipGate of [false, true]) {
    console.log(`=== Sweep — dip-gate: ${dipGate ? 'ON (only add when price < avg cost)' : 'OFF (buy every month)'} ===`);
    console.log(
      pad('tranches', 9) +
        pad('TP%', 5) +
        pad('cycles', 8) +
        pad('med d', 7) +
        pad('p90 d', 7) +
        pad('max d', 7) +
        pad('realised', 11) +
        pad('open P/L', 11) +
        pad('TOTAL', 10) +
        pad('%/yr', 8) +
        pad('worstMTM', 10) +
        pad('in-mkt%', 9),
    );
    for (const t of TRANCHES) {
      for (const tp of TPS) {
        const s = summarize(days, runCycles(days, { tranches: t, tp, dipGate }), years);
        console.log(
          pad(String(t), 9) +
            pad(String(tp), 5) +
            pad(String(s.n), 8) +
            pad(String(s.med), 7) +
            pad(String(s.p90), 7) +
            pad(String(s.max), 7) +
            pad('+$' + s.realised.toFixed(0), 11) +
            pad((s.openPl >= 0 ? '+$' : '-$') + Math.abs(s.openPl).toFixed(0), 11) +
            pad((s.total >= 0 ? '+$' : '-$') + Math.abs(s.total).toFixed(0), 10) +
            pad(s.annual.toFixed(1), 8) +
            pad(s.worst.toFixed(1), 10) +
            pad(s.inMarket.toFixed(0), 9),
        );
      }
      console.log('');
    }
  }

  // seasonal start filter: only open a cycle in the historically weak months
  console.log('=== Seasonal start filter (4 tranches, dip-gate OFF) ===');
  const filters: [string, number[] | undefined][] = [
    ['any month', undefined],
    ['Jun/Aug/Sep', [6, 8, 9]],
    ['May-Sep', [5, 6, 7, 8, 9]],
    ['Jan/Jun/Aug/Sep', [1, 6, 8, 9]],
  ];
  console.log(pad('start months', 18) + pad('TP%', 5) + pad('cycles', 8) + pad('med d', 7) + pad('max d', 7) + pad('TOTAL', 10) + pad('%/yr', 8) + pad('worstMTM', 10));
  for (const [label, months] of filters) {
    for (const tp of [5, 10]) {
      const s = summarize(days, runCycles(days, { tranches: 4, tp, dipGate: false, startMonths: months }), years);
      console.log(
        pad(label, 18) +
          pad(String(tp), 5) +
          pad(String(s.n), 8) +
          pad(String(s.med), 7) +
          pad(String(s.max), 7) +
          pad((s.total >= 0 ? '+$' : '-$') + Math.abs(s.total).toFixed(0), 10) +
          pad(s.annual.toFixed(1), 8) +
          pad(s.worst.toFixed(1), 10),
      );
    }
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
