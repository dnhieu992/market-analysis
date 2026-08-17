/**
 * BTC percentage grid — every lot carries its OWN sell order.
 *
 * What the user asked for: "giá tăng vài % thì bán dần, nếu giảm thì mua lại, đảo liên tục",
 * with each parked bag keeping its own sell order (not merged into one average cost).
 *
 * This is a true grid bot, and it is NOT what the earlier ETH grid runs tested — those sold the
 * WHOLE inventory at avgCost x (1 + tp) (see claude-backtest/runs/2026-08-04-eth-price-step-grid-dca.md).
 * Here each lot is independent: lot bought at P sells at P x (1 + sellPct), regardless of what the
 * rest of the inventory is doing. Deep lots simply sit until price comes back to their own level.
 *
 * Rules
 *   BUY   one lot when price falls `buyPct` below the running high since the last buy
 *         (self-restarting: after any buy the reference resets to that buy price).
 *         Capped by `maxLots` and by available cash. Lot size = capital / maxLots.
 *   SELL  each lot individually when price touches its own entry x (1 + sellPct).
 *   No stop-loss. Spot. Fee both sides.
 *
 * Fill model (`touch`, the default): resting limit orders, so every grid level between the
 * reference and the day's LOW fills in that day, and any lot whose target is under the day's HIGH
 * fills too. `close`: one decision per day at the close, at most one buy and one sell per day.
 *
 * A lot bought today cannot be sold today — deliberately stricter than the ETH grid runs, which
 * processed buys first and checked take-profit on the same candle.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-btc-lot-grid-backtest.ts [startDate] [capital] [feePctPerSide] [endDate] [mode]
 */
import * as https from 'https';

const START = process.argv[2] ?? '2022-01-01';
const CAPITAL = Number(process.argv[3] ?? 2000);
const FEE = Number(process.argv[4] ?? 0.05) / 100;
const END = process.argv[5] ?? '2100-01-01';
const MODE = (process.argv[6] ?? 'touch') as 'touch' | 'close';

const BITSTAMP = 'https://www.bitstamp.net/api/v2/ohlc/btcusd/';

type Day = { ts: number; date: string; open: number; high: number; low: number; close: number };

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

type Lot = { ts: number; date: string; price: number; coins: number; cost: number };

function run(days: Day[], buyPct: number, sellPct: number, maxLots: number, mode = MODE, keepLots = false) {
  const bx = buyPct / 100;
  const sx = sellPct / 100;
  const lotUsd = CAPITAL / maxLots;

  let cash = CAPITAL;
  const lots: Lot[] = [];
  let ref = days[0].open; // running high since the last buy
  let realised = 0;
  let flips = 0;
  let maxLotsHeld = 0;
  let maxDeployed = 0;
  let peak = CAPITAL;
  let maxDd = 0;
  let daysFullyLoaded = 0;
  let oldestOpen = 0;

  const buyOne = (price: number, ts: number, date: string) => {
    if (lots.length >= maxLots || cash < lotUsd) return false;
    const coins = (lotUsd * (1 - FEE)) / price;
    lots.push({ ts, date, price, coins, cost: lotUsd });
    cash -= lotUsd;
    ref = price;
    return true;
  };

  for (const day of days) {
    // ---- buys ----
    if (mode === 'touch') {
      if (day.high > ref) ref = day.high;
      for (;;) {
        const trigger = ref * (1 - bx);
        if (day.low > trigger) break;
        // gap through the level fills at the open
        const fill = day.open < trigger ? day.open : trigger;
        if (!buyOne(fill, day.ts, day.date)) break;
      }
    } else {
      if (day.close > ref) ref = day.close;
      if (day.close <= ref * (1 - bx)) buyOne(day.close, day.ts, day.date);
    }

    // ---- sells: each lot at its own entry x (1 + sellPct), never on its own buy day ----
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

    // ---- bookkeeping ----
    const coins = lots.reduce((a, l) => a + l.coins, 0);
    const deployed = lots.reduce((a, l) => a + l.cost, 0);
    if (lots.length > maxLotsHeld) maxLotsHeld = lots.length;
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
  const invested = lots.reduce((a, l) => a + l.cost, 0);
  const openValue = coins * last.close * (1 - FEE);
  const equity = cash + openValue;
  const years = (last.ts - days[0].ts) / 86400 / 365.25;

  return {
    equity,
    ret: ((equity - CAPITAL) / CAPITAL) * 100,
    annual: (Math.pow(equity / CAPITAL, 1 / years) - 1) * 100,
    flips,
    realised,
    openLots: lots.length,
    openInvested: invested,
    openPl: coins > 0 ? openValue - invested : 0,
    openAvg: coins > 0 ? invested / coins : 0,
    maxLotsHeld,
    maxDeployed,
    pctFullyLoaded: (daysFullyLoaded / days.length) * 100,
    oldestOpen,
    maxDd: maxDd * 100,
    openLotList: keepLots ? [...lots].sort((a, b) => a.price - b.price) : [],
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

const HEADER =
  pad('buy-X%', 8) +
  pad('sell-Y%', 9) +
  pad('lots', 6) +
  pad('equity', 10) +
  pad('total%', 9) +
  pad('%/yr', 8) +
  pad('flips', 7) +
  pad('realised', 10) +
  pad('open$', 8) +
  pad('open P/L', 10) +
  pad('maxDepl', 9) +
  pad('%full', 7) +
  pad('oldest', 8) +
  pad('eqMaxDD', 9);

function line(x: number, y: number, n: number, r: ReturnType<typeof run>) {
  return (
    pad(x.toFixed(0), 8) +
    pad(y.toFixed(0), 9) +
    pad(String(n), 6) +
    pad('$' + r.equity.toFixed(0), 10) +
    pad(r.ret.toFixed(1), 9) +
    pad(r.annual.toFixed(1), 8) +
    pad(String(r.flips), 7) +
    pad('+$' + r.realised.toFixed(0), 10) +
    pad('$' + r.openInvested.toFixed(0), 8) +
    pad((r.openPl >= 0 ? '+$' : '-$') + Math.abs(r.openPl).toFixed(0), 10) +
    pad('$' + r.maxDeployed.toFixed(0), 9) +
    pad(r.pctFullyLoaded.toFixed(0), 7) +
    pad(String(r.oldestOpen), 8) +
    pad(r.maxDd.toFixed(1), 9)
  );
}

async function main() {
  const startSec = Math.floor(new Date(START + 'T00:00:00Z').getTime() / 1000);
  const all = await fetchDaily(startSec);
  const days = all.filter((d) => d.date >= START && d.date < END);
  const first = days[0];
  const last = days[days.length - 1];
  const years = (last.ts - first.ts) / 86400 / 365.25;
  const bh = (CAPITAL * (1 - FEE) * last.close) / first.open;

  console.log(`\nBTC/USD (Bitstamp daily) ${first.date} → ${last.date}  (${years.toFixed(2)}y) · fill model: ${MODE}`);
  console.log(`$${CAPITAL} · lot = capital/maxLots · fee ${(FEE * 100).toFixed(3)}%/side · each lot sells at its OWN entry x (1+Y)`);
  console.log(`BUY & HOLD: $${bh.toFixed(0)}  (${(((bh - CAPITAL) / CAPITAL) * 100).toFixed(1)}%, ${((Math.pow(bh / CAPITAL, 1 / years) - 1) * 100).toFixed(1)}%/yr, maxDD ${bhMaxDd(days).toFixed(1)}%)`);

  console.log('\n=== 1. Symmetric grid (buy step = sell step), 40 lots ===');
  console.log(HEADER);
  for (const x of [1, 2, 3, 5, 7, 10]) console.log(line(x, x, 40, run(days, x, x, 40)));

  console.log('\n=== 2. Buy step x sell step, 40 lots ===');
  console.log(HEADER);
  for (const x of [2, 3, 5, 7]) {
    for (const y of [2, 3, 5, 7, 10]) console.log(line(x, y, 40, run(days, x, y, 40)));
    console.log('');
  }

  console.log('=== 3. Grid depth (how many lots the capital is split into) ===');
  console.log(HEADER);
  for (const n of [10, 20, 30, 40, 60, 80]) {
    for (const [x, y] of [[3, 5], [5, 5], [5, 10]] as [number, number][]) console.log(line(x, y, n, run(days, x, y, n)));
    console.log('');
  }

  // Where the recommended config stands right now: the lots still open and the price each one
  // is waiting for. This is the order book you would actually have to place today.
  const [dx, dy, dn] = (process.env.GRID_DETAIL ?? '3,5,20').split(',').map(Number);
  const d = run(days, dx, dy, dn, MODE, true);
  console.log(`=== Open lots today — buy ${dx}% / sell ${dy}% / ${dn} lots ($${(CAPITAL / dn).toFixed(0)} each) ===`);
  console.log(`last close ${last.close.toFixed(0)} · ${d.openLots} lots open · $${d.openInvested.toFixed(0)} deployed · $${(CAPITAL - d.openInvested + d.realised).toFixed(0)} cash`);
  console.log(pad('bought', 12) + pad('entry', 10) + pad('sell at', 10) + pad('vs now', 9) + pad('held d', 8));
  for (const l of d.openLotList) {
    const target = l.price * (1 + dy / 100);
    console.log(
      pad(l.date, 12) +
        pad(l.price.toFixed(0), 10) +
        pad(target.toFixed(0), 10) +
        pad((((last.close - target) / target) * 100).toFixed(1) + '%', 9) +
        pad(String(Math.round((last.ts - l.ts) / 86400)), 8),
    );
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
