/**
 * Backtest: DAILY FIXED-$ DCA → take profit at a target that DECAYS the longer the cycle runs.
 *
 * Variant 2 of the user's daily-DCA rule (baseline = `run-daily-dca-tp-cycle-backtest.ts`):
 *   - Every day buy `dailyUsd` at the daily OPEN. Sell 100% when price ≥ target. No stop-loss.
 *   - The cycle ends that day; the next day starts a fresh cycle.
 *   - **Target is no longer fixed.** It starts at `tpStart` and drops by `decay` percentage
 *     points per 30 days held, floored at `tpFloor`:
 *
 *         tpNow = max(tpFloor, tpStart − decay × daysHeld / 30)
 *         target = avgCost × (1 + tpNow)
 *
 *     Decay is prorated daily (a limit order nudged down every day). A floor of 0 means the
 *     rule degenerates to "eventually just get out at breakeven".
 *
 * `tpMode`: `touch` = resting limit sell fills when the daily HIGH reaches the target;
 *           `close`  = only exits if the daily CLOSE is at/above the target.
 *
 * `decay` and `tpFloor` accept comma lists → the script sweeps the grid and prints one summary
 * row per config. Per-cycle detail is printed only when the grid is a single config.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-daily-dca-decay-tp-backtest.ts [symbol] [start] [end] [dailyUsd] [tpStart] [decayList] [floorList] [feePctPerSide] [tpMode]
 *
 *   # user's idea: start 15%, −1 point/month, floor 3%
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-daily-dca-decay-tp-backtest.ts ETHUSDT 2025-01-01 2026-08-04 10 15 1 3 0.05 touch
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;

const SYMBOL = (process.argv[2] ?? 'ETHUSDT').toUpperCase();
const START = process.argv[3] ?? '2025-01-01';
const END = process.argv[4] ?? new Date().toISOString().slice(0, 10);
const DAILY_USD = Number(process.argv[5] ?? 10);
const TP_START = Number(process.argv[6] ?? 15) / 100;
const DECAYS = (process.argv[7] ?? '1').split(',').map((s) => Number(s.trim()) / 100);
const FLOORS = (process.argv[8] ?? '3').split(',').map((s) => Number(s.trim()) / 100);
const FEE = Number(process.argv[9] ?? 0.05) / 100;
const TP_MODE = (process.argv[10] ?? 'touch') as 'touch' | 'close';

type Candle = { open: number; high: number; low: number; close: number; openTime: Date };

function fetchJson(url: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
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
      out.push({
        openTime: new Date(k[0] as number),
        open: parseFloat(k[1] as string),
        high: parseFloat(k[2] as string),
        low: parseFloat(k[3] as string),
        close: parseFloat(k[4] as string),
      });
    }
    if (batch.length < MAX_PER_REQ) break;
    cur = (batch[batch.length - 1]![0] as number) + 1;
  }
  return out;
}

const fmt = (n: number, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const day = (d: Date) => d.toISOString().slice(0, 10);

type Cycle = {
  startDate: string; endDate: string; days: number; buys: number; invested: number;
  avgCost: number; tpAtExit: number; exitPrice: number; profit: number; maxDrawdownPct: number;
};
type Result = {
  decay: number; floor: number; cycles: Cycle[];
  openDays: number; openBuys: number; openInvested: number; openAvg: number;
  openTpNow: number; openTarget: number; openPnl: number; openDdPct: number;
  peakCapital: number;
};

function run(candles: Candle[], decay: number, floor: number): Result {
  const cycles: Cycle[] = [];
  let startDate = '', buys = 0, invested = 0, qty = 0, dd = 0, live = false;
  let peakCapital = 0;
  const last = candles[candles.length - 1]!;

  for (const c of candles) {
    if (!live) { startDate = day(c.openTime); buys = 0; invested = 0; qty = 0; dd = 0; live = true; }

    buys += 1;
    invested += DAILY_USD;
    qty += (DAILY_USD * (1 - FEE)) / c.open;
    const avgCost = invested / qty;
    peakCapital = Math.max(peakCapital, invested);
    dd = Math.min(dd, (c.low * qty - invested) / invested * 100);

    const daysHeld = (Date.parse(day(c.openTime)) - Date.parse(startDate)) / 86400000;
    const tpNow = Math.max(floor, TP_START - decay * (daysHeld / 30));
    const target = avgCost * (1 + tpNow);

    const hit = TP_MODE === 'touch' ? c.high >= target : c.close >= target;
    if (hit) {
      const exit = TP_MODE === 'touch' ? target : c.close;
      cycles.push({
        startDate, endDate: day(c.openTime), days: daysHeld + 1, buys, invested, avgCost,
        tpAtExit: tpNow, exitPrice: exit, profit: qty * exit * (1 - FEE) - invested, maxDrawdownPct: dd,
      });
      live = false;
    }
  }

  const openDaysHeld = live ? (Date.parse(day(last.openTime)) - Date.parse(startDate)) / 86400000 + 1 : 0;
  const openAvg = live ? invested / qty : 0;
  const openTpNow = live ? Math.max(floor, TP_START - decay * ((openDaysHeld - 1) / 30)) : 0;
  return {
    decay, floor, cycles,
    openDays: openDaysHeld, openBuys: live ? buys : 0, openInvested: live ? invested : 0,
    openAvg, openTpNow, openTarget: live ? openAvg * (1 + openTpNow) : 0,
    openPnl: live ? qty * last.close - invested : 0,
    openDdPct: live ? dd : 0,
    peakCapital,
  };
}

async function main() {
  const candles = await fetchKlines(SYMBOL, '1d', Date.parse(`${START}T00:00:00Z`), Date.parse(`${END}T23:59:59Z`));
  if (candles.length === 0) { console.log('No data.'); return; }
  const last = candles[candles.length - 1]!;

  console.log(`\n=== DAILY DCA + DECAYING AVG-COST TP — ${SYMBOL} ===`);
  console.log(`Period   : ${day(candles[0]!.openTime)} → ${day(last.openTime)} (${candles.length} days, last close ${fmt(last.close)})`);
  console.log(`Rule     : buy $${fmt(DAILY_USD)}/day at open; target = avgCost × (1 + tpNow), sell 100% on hit; next day = new cycle`);
  console.log(`           tpNow = max(floor, ${fmt(TP_START * 100, 1)}% − decay × daysHeld/30), prorated daily`);
  console.log(`TP fill  : ${TP_MODE === 'touch' ? 'intraday touch (resting limit sell)' : 'daily close ≥ target'} · Fee ${fmt(FEE * 100, 3)}%/side\n`);

  const results: Result[] = [];
  for (const d of DECAYS) for (const f of FLOORS) results.push(run(candles, d, f));

  console.log('decay/mo  floor   cycles   realised   longest   avg days   openDays   openIn     open%     netP/L');
  console.log('-'.repeat(103));
  for (const r of results) {
    const realised = r.cycles.reduce((s, c) => s + c.profit, 0);
    const longest = r.cycles.reduce((m, c) => Math.max(m, c.days), 0);
    const avgDays = r.cycles.length ? r.cycles.reduce((s, c) => s + c.days, 0) / r.cycles.length : 0;
    console.log(
      `${(fmt(r.decay * 100, 1) + '%').padStart(7)}  ${(fmt(r.floor * 100, 1) + '%').padStart(5)}   ` +
      `${String(r.cycles.length).padStart(6)}   ${('$' + fmt(realised)).padStart(8)}   ${String(longest).padStart(7)}   ` +
      `${fmt(avgDays, 1).padStart(8)}   ${String(r.openDays).padStart(8)}   ${('$' + fmt(r.openInvested, 0)).padStart(7)}   ` +
      `${(fmt(r.openInvested ? r.openPnl / r.openInvested * 100 : 0, 1) + '%').padStart(7)}   ${('$' + fmt(realised + r.openPnl)).padStart(9)}`,
    );
  }

  if (results.length === 1) {
    const r = results[0]!;
    console.log('\n#    start        end          days   buys   invested    avgCost     TP@exit   exit        profit     ROI%    worstDD%');
    console.log('-'.repeat(120));
    r.cycles.forEach((c, i) => {
      console.log(
        `${String(i + 1).padEnd(4)} ${c.startDate}   ${c.endDate}   ${String(c.days).padStart(4)}   ${String(c.buys).padStart(4)}   ` +
        `${('$' + fmt(c.invested)).padStart(9)}   ${fmt(c.avgCost).padStart(9)}   ${(fmt(c.tpAtExit * 100, 1) + '%').padStart(6)}   ` +
        `${fmt(c.exitPrice).padStart(9)}   ${('$' + fmt(c.profit)).padStart(8)}   ${fmt(c.profit / c.invested * 100).padStart(5)}   ${fmt(c.maxDrawdownPct, 1).padStart(7)}`,
      );
    });
    if (r.openInvested > 0) {
      console.log(
        `OPEN ${''.padEnd(12)} (running)    ${String(r.openDays).padStart(4)}   ${String(r.openBuys).padStart(4)}   ` +
        `${('$' + fmt(r.openInvested)).padStart(9)}   ${fmt(r.openAvg).padStart(9)}   ${(fmt(r.openTpNow * 100, 1) + '%').padStart(6)}   ` +
        `${fmt(r.openTarget).padStart(9)}   ${('$' + fmt(r.openPnl)).padStart(8)}   ${fmt(r.openPnl / r.openInvested * 100).padStart(5)}   ${fmt(r.openDdPct, 1).padStart(7)}`,
      );
      console.log(`\nOpen cycle needs ${fmt(r.openTarget)} (TP now ${fmt(r.openTpNow * 100, 1)}%), last close ${fmt(last.close)} → ${fmt((r.openTarget / last.close - 1) * 100, 1)}% away.`);
    }
    console.log(`Peak capital in one cycle: $${fmt(r.peakCapital)}\n`);
  } else {
    console.log('\n(run with a single decay + floor to see the per-cycle table)\n');
  }
}

void main();
