/**
 * Backtest: BTC MONTHLY DCA with a $2,000 budget → exit the whole bag at +5% over AVERAGE COST.
 *
 * Rule (one "cycle"):
 *   - On day 1 of each month (00:00 UTC) buy a USD amount decided by the weight profile.
 *   - Keep buying month after month until the $2,000 budget is fully deployed (then just hold).
 *   - Every day, if the daily HIGH touches avgCost x (1 + tp), SELL EVERYTHING at that price.
 *   - Cycle closes; a new cycle starts on the 1st of the NEXT month with the full $2,000 again.
 *   - No stop-loss. Spot. Fee charged on both sides.
 *
 * Weight profiles (how the $2,000 is split across the 12 calendar months):
 *   flat      — 1/12 every month.
 *   seasonal  — heavy in the historically weak months (Jun/Aug/Sep), light in the strong ones
 *               (Apr/Jul/Oct/Nov), medium otherwise. Derived from the 2017+ seasonality table.
 *   weakonly  — only buys in Jun/Aug/Sep (plus May), nothing in other months.
 *   lump      — the whole $2,000 on the first month of the cycle.
 *
 * Also prints a ROLLING-START analysis: start the program on every single month in the sample
 * and record how long the first +5% exit took — the honest distribution of "how long do I wait".
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-btc-monthly-dca-2000-backtest.ts [startDate] [budget] [tpPct] [feePctPerSide]
 *
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-btc-monthly-dca-2000-backtest.ts 2017-01-01 2000 5 0.05
 */
import * as https from 'https';

const START = process.argv[2] ?? '2017-01-01';
const BUDGET = Number(process.argv[3] ?? 2000);
const TP = Number(process.argv[4] ?? 5) / 100;
const FEE = Number(process.argv[5] ?? 0.05) / 100;

const BITSTAMP = 'https://www.bitstamp.net/api/v2/ohlc/btcusd/';

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

// --- weight profiles: USD share per calendar month (index 0 = Jan) ---
const PROFILES: Record<string, number[]> = {
  //          Jan   Feb   Mar   Apr   May   Jun   Jul   Aug   Sep   Oct   Nov   Dec
  flat: Array(12).fill(1 / 12),
  seasonal: [0.065, 0.065, 0.065, 0.056, 0.065, 0.15, 0.056, 0.15, 0.15, 0.056, 0.056, 0.065],
  weakonly: [0, 0, 0, 0, 0.2, 0.3, 0, 0.25, 0.25, 0, 0, 0],
  lump: Array(12).fill(0), // handled specially
};

type Cycle = {
  start: string;
  end: string | null;
  days: number;
  buys: number;
  invested: number;
  avgCost: number;
  exit: number | null;
  profit: number;
  mtmWorstPct: number; // worst unrealised drawdown vs invested during the cycle
};

function runCycles(days: Day[], profile: string): { cycles: Cycle[]; totalProfit: number } {
  const w = PROFILES[profile];
  const cycles: Cycle[] = [];
  let i = 0;
  while (i < days.length) {
    // a cycle always starts on the 1st of a month
    while (i < days.length && days[i].d !== 1) i++;
    if (i >= days.length) break;

    let invested = 0;
    let coins = 0;
    let buys = 0;
    let worst = 0;
    const startDate = days[i].date;
    let closed = false;
    let j = i;
    let lastMonthBought = -1;

    for (; j < days.length; j++) {
      const day = days[j];
      // ---- monthly buy at the open ----
      const monthKey = day.y * 12 + day.m;
      if (day.d === 1 && monthKey !== lastMonthBought && invested < BUDGET - 0.01) {
        let amt: number;
        if (profile === 'lump') {
          amt = buys === 0 ? BUDGET : 0;
        } else {
          amt = BUDGET * w[day.m - 1];
        }
        amt = Math.min(amt, BUDGET - invested);
        if (amt > 0.01) {
          coins += (amt * (1 - FEE)) / day.open;
          invested += amt;
          buys++;
          lastMonthBought = monthKey;
        }
      }
      if (coins <= 0) continue;

      const avgCost = invested / coins;
      const target = avgCost * (1 + TP);
      // worst unrealised MTM of the cycle (on the daily low)
      const mtm = (coins * day.low - invested) / invested;
      if (mtm < worst) worst = mtm;

      if (day.high >= target) {
        const proceeds = coins * target * (1 - FEE);
        cycles.push({
          start: startDate,
          end: day.date,
          days: Math.round((day.ts - days[i].ts) / 86400),
          buys,
          invested,
          avgCost,
          exit: target,
          profit: proceeds - invested,
          mtmWorstPct: worst * 100,
        });
        closed = true;
        break;
      }
    }

    if (!closed) {
      const last = days[days.length - 1];
      const avgCost = coins > 0 ? invested / coins : 0;
      cycles.push({
        start: startDate,
        end: null,
        days: Math.round((last.ts - days[i].ts) / 86400),
        buys,
        invested,
        avgCost,
        exit: null,
        profit: coins * last.close * (1 - FEE) - invested,
        mtmWorstPct: worst * 100,
      });
      break;
    }

    // next cycle starts on the 1st of the following month
    const endDay = days[j];
    let k = j;
    while (k < days.length && !(days[k].d === 1 && (days[k].y * 12 + days[k].m) > endDay.y * 12 + endDay.m)) k++;
    i = k;
  }
  const totalProfit = cycles.reduce((a, c) => a + c.profit, 0);
  return { cycles, totalProfit };
}

/** Start the program on EVERY month and record days until the first +5% exit. */
function rollingStarts(days: Day[], profile: string): { start: string; days: number | null; invested: number; worst: number }[] {
  const w = PROFILES[profile];
  const out: { start: string; days: number | null; invested: number; worst: number }[] = [];
  for (let i = 0; i < days.length; i++) {
    if (days[i].d !== 1) continue;
    let invested = 0;
    let coins = 0;
    let buys = 0;
    let worst = 0;
    let lastMonthBought = -1;
    let hit: number | null = null;
    for (let j = i; j < days.length; j++) {
      const day = days[j];
      const monthKey = day.y * 12 + day.m;
      if (day.d === 1 && monthKey !== lastMonthBought && invested < BUDGET - 0.01) {
        let amt = profile === 'lump' ? (buys === 0 ? BUDGET : 0) : BUDGET * w[day.m - 1];
        amt = Math.min(amt, BUDGET - invested);
        if (amt > 0.01) {
          coins += (amt * (1 - FEE)) / day.open;
          invested += amt;
          buys++;
          lastMonthBought = monthKey;
        }
      }
      if (coins <= 0) continue;
      const avgCost = invested / coins;
      const mtm = (coins * day.low - invested) / invested;
      if (mtm < worst) worst = mtm;
      if (day.high >= avgCost * (1 + TP)) {
        hit = Math.round((day.ts - days[i].ts) / 86400);
        break;
      }
    }
    out.push({ start: days[i].date, days: hit, invested, worst: worst * 100 });
  }
  return out;
}

function pct(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
function pad(s: string, n: number) {
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

async function main() {
  const startSec = Math.floor(new Date(START + 'T00:00:00Z').getTime() / 1000);
  const all = await fetchDaily(startSec);
  const days = all.filter((d) => d.date >= START);

  console.log(`\nBTC/USD (Bitstamp daily) ${days[0].date} → ${days[days.length - 1].date}  (${days.length} days)`);
  console.log(`budget $${BUDGET} · TP +${(TP * 100).toFixed(0)}% over avg cost · fee ${(FEE * 100).toFixed(3)}%/side\n`);

  console.log('=== A. Repeating cycles (exit at +5%, restart next month) ===');
  console.log(
    pad('profile', 10) +
      pad('cycles', 8) +
      pad('closed', 8) +
      pad('avg days', 10) +
      pad('med days', 10) +
      pad('max days', 10) +
      pad('avg $ in', 10) +
      pad('total P/L', 12) +
      pad('worst MTM%', 12),
  );
  const detail: Record<string, Cycle[]> = {};
  for (const profile of ['flat', 'seasonal', 'weakonly', 'lump']) {
    const { cycles, totalProfit } = runCycles(days, profile);
    detail[profile] = cycles;
    const closed = cycles.filter((c) => c.end);
    const ds = closed.map((c) => c.days);
    const avgIn = cycles.reduce((a, c) => a + c.invested, 0) / cycles.length;
    const worst = Math.min(...cycles.map((c) => c.mtmWorstPct));
    console.log(
      pad(profile, 10) +
        pad(String(cycles.length), 8) +
        pad(String(closed.length), 8) +
        pad(ds.length ? (ds.reduce((a, b) => a + b, 0) / ds.length).toFixed(0) : '-', 10) +
        pad(ds.length ? String(pct(ds, 50)) : '-', 10) +
        pad(ds.length ? String(Math.max(...ds)) : '-', 10) +
        pad('$' + avgIn.toFixed(0), 10) +
        pad((totalProfit >= 0 ? '+$' : '-$') + Math.abs(totalProfit).toFixed(0), 12) +
        pad(worst.toFixed(1), 12),
    );
  }

  console.log('\n=== B. Rolling starts — days until the FIRST +5% exit ===');
  console.log(
    pad('profile', 10) +
      pad('starts', 8) +
      pad('hit%', 8) +
      pad('med d', 8) +
      pad('p75 d', 8) +
      pad('p90 d', 8) +
      pad('max d', 8) +
      pad('never', 8) +
      pad('worst MTM%', 12),
  );
  for (const profile of ['flat', 'seasonal', 'weakonly', 'lump']) {
    const rs = rollingStarts(days, profile);
    const hits = rs.filter((r) => r.days !== null).map((r) => r.days as number);
    const never = rs.length - hits.length;
    console.log(
      pad(profile, 10) +
        pad(String(rs.length), 8) +
        pad(((hits.length / rs.length) * 100).toFixed(0), 8) +
        pad(String(pct(hits, 50)), 8) +
        pad(String(pct(hits, 75)), 8) +
        pad(String(pct(hits, 90)), 8) +
        pad(String(Math.max(...hits)), 8) +
        pad(String(never), 8) +
        pad(Math.min(...rs.map((r) => r.worst)).toFixed(1), 12),
    );
  }

  console.log('\n=== C. Cycle detail — seasonal ===');
  console.log(
    pad('#', 4) + pad('start', 12) + pad('end', 12) + pad('days', 6) + pad('buys', 6) + pad('invested', 10) + pad('avgCost', 11) + pad('exit', 11) + pad('P/L', 10) + pad('worstMTM%', 11),
  );
  detail.seasonal.forEach((c, n) => {
    console.log(
      pad(String(n + 1), 4) +
        pad(c.start, 12) +
        pad(c.end ?? 'OPEN', 12) +
        pad(String(c.days), 6) +
        pad(String(c.buys), 6) +
        pad('$' + c.invested.toFixed(0), 10) +
        pad(c.avgCost.toFixed(0), 11) +
        pad(c.exit ? c.exit.toFixed(0) : '-', 11) +
        pad((c.profit >= 0 ? '+' : '-') + '$' + Math.abs(c.profit).toFixed(0), 10) +
        pad(c.mtmWorstPct.toFixed(1), 11),
    );
  });

  console.log('\n=== D. Cycle detail — flat ===');
  detail.flat.forEach((c, n) => {
    console.log(
      pad(String(n + 1), 4) +
        pad(c.start, 12) +
        pad(c.end ?? 'OPEN', 12) +
        pad(String(c.days), 6) +
        pad(String(c.buys), 6) +
        pad('$' + c.invested.toFixed(0), 10) +
        pad(c.avgCost.toFixed(0), 11) +
        pad(c.exit ? c.exit.toFixed(0) : '-', 11) +
        pad((c.profit >= 0 ? '+' : '-') + '$' + Math.abs(c.profit).toFixed(0), 10) +
        pad(c.mtmWorstPct.toFixed(1), 11),
    );
  });
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
