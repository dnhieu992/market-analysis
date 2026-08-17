/**
 * BTC seasonal calendar DCA — exit rules for the cycle that never closes.
 *
 * Follow-up to scripts/run-btc-seasonal-calendar-dca.ts. That run settled on
 * "buy the 1st of May/Jun/Aug/Dec, $1,000 a tranche, sell all at avgCost x 1.06",
 * and left one structural hole open: the rule has no way out of a losing cycle.
 * In 2022 the bag was held 292 days; a deeper leg down locks the capital forever.
 *
 * This script tests the three candidate fixes against that same baseline:
 *
 *   1. TIME CAP    — force a market exit at the close once the bag is N days old.
 *   2. DECAYING TP — the target starts high and steps down every 30 days held,
 *                    floored at `floor` (which may be negative = accept a loss).
 *   3. PARTIAL     — a ladder: sell part of the bag at the first target, the rest higher.
 *
 * Same mechanics as the baseline: spot, no stop-loss, compounded capital
 * (tranche = currentCapital / div), fee both sides, TP fills on the daily HIGH
 * touching the target (a resting limit sell), forced exits fill at the close.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-btc-seasonal-dca-exit-rules.ts [startDate] [capital] [feePctPerSide] [endDate]
 */
import * as https from 'https';

const START = process.argv[2] ?? '2022-01-01';
const CAPITAL = Number(process.argv[3] ?? 2000);
const FEE = Number(process.argv[4] ?? 0.05) / 100;
const END = process.argv[5] ?? '2100-01-01';

const BITSTAMP = 'https://www.bitstamp.net/api/v2/ohlc/btcusd/';
const BUY_MONTHS = [5, 6, 8, 12]; // May / Jun / Aug / Dec — the weak months of 2022-2026
const DIV = 2; // tranche = capital / 2

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

/**
 * capDays   — force-close the bag at the close once it is this old (0 = never).
 * decayStep — subtract this many % from the target every 30 days held (0 = fixed target).
 * decayFloor— the target never decays below this % (may be negative).
 * ladder    — partial exits: [tp%, fraction of the CURRENT bag to sell]. The last rung
 *             should be 1 so the cycle can close.
 */
type Cfg = {
  label: string;
  tp: number;
  capDays?: number;
  decayStep?: number;
  decayFloor?: number;
  ladder?: [number, number][];
};

type Ev = { kind: string; date: string; price: number; usd: number; avgCost?: number; heldDays?: number; profit?: number };

function run(days: Day[], cfg: Cfg, log?: Ev[]) {
  let cash = CAPITAL;
  let coins = 0;
  let invested = 0;
  let cycleStartTs = 0;
  let inCycle = false;
  let rung = 0; // ladder progress inside the current cycle
  let lastMonth = -1;
  let peakEquity = CAPITAL;
  let maxDd = 0;
  const waits: number[] = [];
  const profits: number[] = [];
  let forced = 0; // cycles closed by the time cap
  let lossTrades = 0;

  const closeCycle = (day: Day, heldDays: number) => {
    waits.push(heldDays);
    coins = 0;
    invested = 0;
    inCycle = false;
    rung = 0;
  };

  for (const day of days) {
    const mk = day.y * 12 + day.m;
    if (day.d === 1 && mk !== lastMonth && BUY_MONTHS.includes(day.m)) {
      lastMonth = mk;
      const size = Math.min(cash, (cash + invested) / DIV);
      if (size > 1) {
        coins += (size * (1 - FEE)) / day.open;
        cash -= size;
        invested += size;
        if (!inCycle) {
          inCycle = true;
          cycleStartTs = day.ts;
        }
        log?.push({ kind: 'BUY', date: day.date, price: day.open, usd: size, avgCost: invested / coins });
      }
    }

    if (cash + coins * day.high > peakEquity) peakEquity = cash + coins * day.high;
    const dd = (cash + coins * day.low - peakEquity) / peakEquity;
    if (dd < maxDd) maxDd = dd;

    if (coins <= 0) continue;
    const held = Math.round((day.ts - cycleStartTs) / 86400);
    const avgCost = invested / coins;

    // --- ladder (partial exits) ---
    if (cfg.ladder) {
      while (rung < cfg.ladder.length) {
        const [tpPct, frac] = cfg.ladder[rung];
        const target = avgCost * (1 + tpPct / 100);
        if (day.high < target) break;
        const sellCoins = coins * frac;
        const costOut = invested * frac;
        const proceeds = sellCoins * target * (1 - FEE);
        cash += proceeds;
        coins -= sellCoins;
        invested -= costOut;
        profits.push(proceeds - costOut);
        if (proceeds - costOut < 0) lossTrades++;
        log?.push({ kind: frac >= 1 ? 'SELL' : `SELL${Math.round(frac * 100)}`, date: day.date, price: target, usd: proceeds, avgCost, heldDays: held, profit: proceeds - costOut });
        rung++;
        if (coins <= 1e-12) {
          closeCycle(day, held);
          break;
        }
      }
      if (coins <= 0) continue;
    } else {
      // --- single target, optionally decaying with time held ---
      let tpPct = cfg.tp;
      if (cfg.decayStep) {
        tpPct = Math.max(cfg.decayFloor ?? 0, cfg.tp - cfg.decayStep * Math.floor(held / 30));
      }
      const target = avgCost * (1 + tpPct / 100);
      if (day.high >= target) {
        const proceeds = coins * target * (1 - FEE);
        const profit = proceeds - invested;
        cash += proceeds;
        profits.push(profit);
        if (profit < 0) lossTrades++;
        log?.push({ kind: 'SELL', date: day.date, price: target, usd: proceeds, avgCost, heldDays: held, profit });
        closeCycle(day, held);
        continue;
      }
    }

    // --- time cap: bail out at the close ---
    if (cfg.capDays && held >= cfg.capDays) {
      const proceeds = coins * day.close * (1 - FEE);
      const profit = proceeds - invested;
      cash += proceeds;
      profits.push(profit);
      if (profit < 0) lossTrades++;
      forced++;
      log?.push({ kind: 'CAP', date: day.date, price: day.close, usd: proceeds, avgCost, heldDays: held, profit });
      closeCycle(day, held);
    }
  }

  const last = days[days.length - 1];
  const openValue = coins * last.close * (1 - FEE);
  const equity = cash + openValue;
  const years = (last.ts - days[0].ts) / 86400 / 365.25;
  const sorted = [...waits].sort((a, b) => a - b);
  return {
    equity,
    ret: ((equity - CAPITAL) / CAPITAL) * 100,
    annual: (Math.pow(equity / CAPITAL, 1 / years) - 1) * 100,
    trades: profits.length,
    cycles: waits.length,
    lossTrades,
    forced,
    realised: profits.reduce((a, b) => a + b, 0),
    openPl: coins > 0 ? openValue - invested : 0,
    openDays: coins > 0 ? Math.round((last.ts - cycleStartTs) / 86400) : 0,
    medWait: sorted.length ? sorted[Math.floor(sorted.length / 2)] : NaN,
    maxWait: sorted.length ? sorted[sorted.length - 1] : NaN,
    maxDd: maxDd * 100,
  };
}

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

const CFGS: Cfg[] = [
  // baseline from the 2026-08-07 run
  { label: 'baseline TP6', tp: 6 },
  { label: 'baseline TP8', tp: 8 },

  // 1. time cap
  { label: 'TP6 cap 60d', tp: 6, capDays: 60 },
  { label: 'TP6 cap 90d', tp: 6, capDays: 90 },
  { label: 'TP6 cap 120d', tp: 6, capDays: 120 },
  { label: 'TP6 cap 180d', tp: 6, capDays: 180 },
  { label: 'TP6 cap 270d', tp: 6, capDays: 270 },
  { label: 'TP6 cap 365d', tp: 6, capDays: 365 },
  { label: 'TP8 cap 180d', tp: 8, capDays: 180 },
  { label: 'TP10 cap 180d', tp: 10, capDays: 180 },

  // 2. decaying target
  { label: 'TP8 -1%/30d f0', tp: 8, decayStep: 1, decayFloor: 0 },
  { label: 'TP8 -2%/30d f0', tp: 8, decayStep: 2, decayFloor: 0 },
  { label: 'TP10 -2%/30d f0', tp: 10, decayStep: 2, decayFloor: 0 },
  { label: 'TP10 -1%/30d f0', tp: 10, decayStep: 1, decayFloor: 0 },
  { label: 'TP12 -2%/30d f0', tp: 12, decayStep: 2, decayFloor: 0 },
  { label: 'TP8 -2%/30d f-5', tp: 8, decayStep: 2, decayFloor: -5 },
  { label: 'TP10 -2%/30d f-10', tp: 10, decayStep: 2, decayFloor: -10 },

  // 3. partial exits
  { label: 'half@5 rest@10', tp: 0, ladder: [[5, 0.5], [10, 1]] },
  { label: 'half@6 rest@12', tp: 0, ladder: [[6, 0.5], [12, 1]] },
  { label: 'half@8 rest@15', tp: 0, ladder: [[8, 0.5], [15, 1]] },
  { label: 'third@5/10/20', tp: 0, ladder: [[5, 1 / 3], [10, 0.5], [20, 1]] },

  // combinations — the point of the exercise: keep the upside, cap the lock-up
  { label: 'half@6 rest@12 cap180', tp: 0, capDays: 180, ladder: [[6, 0.5], [12, 1]] },
  { label: 'half@8 rest@15 cap180', tp: 0, capDays: 180, ladder: [[8, 0.5], [15, 1]] },
  { label: 'TP10 -2%/30d cap365', tp: 10, decayStep: 2, decayFloor: 0, capDays: 365 },
  { label: 'TP8 -2%/30d cap270', tp: 8, decayStep: 2, decayFloor: 0, capDays: 270 },
];

async function main() {
  const startSec = Math.floor(new Date(START + 'T00:00:00Z').getTime() / 1000);
  const all = await fetchDaily(startSec);
  const days = all.filter((d) => d.date >= START && d.date < END);
  const first = days[0];
  const last = days[days.length - 1];
  const years = (last.ts - first.ts) / 86400 / 365.25;
  const bh = (CAPITAL * (1 - FEE) * last.close) / first.open;

  console.log(`\nBTC/USD (Bitstamp daily) ${first.date} → ${last.date}  (${years.toFixed(2)}y)`);
  console.log(`buy 1st of ${BUY_MONTHS.join('/')} · tranche = capital/${DIV} · $${CAPITAL} compounded · fee ${(FEE * 100).toFixed(3)}%/side`);
  console.log(`BUY & HOLD: $${bh.toFixed(0)}  (${(((bh - CAPITAL) / CAPITAL) * 100).toFixed(1)}%, ${((Math.pow(bh / CAPITAL, 1 / years) - 1) * 100).toFixed(1)}%/yr, maxDD ${bhMaxDd(days).toFixed(1)}%)\n`);

  const header =
    pad('exit rule', 24) +
    pad('equity', 10) +
    pad('total%', 9) +
    pad('%/yr', 8) +
    pad('fills', 7) +
    pad('loss', 6) +
    pad('capped', 8) +
    pad('open P/L', 10) +
    pad('med d', 7) +
    pad('max d', 7) +
    pad('openD', 7) +
    pad('eqMaxDD', 9);
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const cfg of CFGS) {
    const r = run(days, cfg);
    console.log(
      pad(cfg.label, 24) +
        pad('$' + r.equity.toFixed(0), 10) +
        pad(r.ret.toFixed(1), 9) +
        pad(r.annual.toFixed(1), 8) +
        pad(String(r.trades), 7) +
        pad(String(r.lossTrades), 6) +
        pad(String(r.forced), 8) +
        pad((r.openPl >= 0 ? '+$' : '-$') + Math.abs(r.openPl).toFixed(0), 10) +
        pad(String(r.medWait), 7) +
        pad(String(r.maxWait), 7) +
        pad(String(r.openDays), 7) +
        pad(r.maxDd.toFixed(1), 9),
    );
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
