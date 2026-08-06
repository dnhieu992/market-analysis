/**
 * Backtest: HYBRID DCA — price-step grid first, switch to DAILY buying after a deep drawdown.
 *
 * Rule:
 *   - A cycle opens with one buy at the daily OPEN. That price is the cycle's ANCHOR.
 *   - Phase 1 (grid): buy $X every time price trades `step` dollars below the last buy.
 *   - SWITCH: the first time price trades at/below anchor × (1 - switchPct), the cycle flips to
 *     phase 2 for good.
 *   - Phase 2 (daily): buy $X at every daily open, no price condition at all.
 *   - Exit unchanged: sell 100% at avgCost × (1 + tp), next day opens a fresh cycle. No SL.
 *
 * Fill model (`mode`):
 *   - `touch` — grid levels fill against the daily LOW (several per day), TP on the daily HIGH.
 *   - `close` — once-a-day check at the CLOSE: max one grid buy/day, TP only on the close.
 *   Phase 2 always buys at the daily OPEN in both models.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-grid-then-daily-dca-backtest.ts [symbol] [start] [end] [usdPerBuy] [stepUsd] [switchPct] [tpPct] [feePctPerSide] [mode]
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;

const SYMBOL = (process.argv[2] ?? 'ETHUSDT').toUpperCase();
const START = process.argv[3] ?? '2025-01-01';
const END = process.argv[4] ?? new Date().toISOString().slice(0, 10);
const USD_PER_BUY = Number(process.argv[5] ?? 10);
const STEP = Number(process.argv[6] ?? 50);
const SWITCH_PCT = Number(process.argv[7] ?? 30) / 100;
const TP_PCT = Number(process.argv[8] ?? 10) / 100;
const FEE = Number(process.argv[9] ?? 0.05) / 100;
const MODE = (process.argv[10] ?? 'touch') as 'touch' | 'close';

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
  startDate: string; endDate: string | null; days: number;
  anchor: number; switchPrice: number; switchDate: string | null;
  buys: number; gridBuys: number; dailyBuys: number;
  invested: number; gridInvested: number; qty: number; gridQty: number;
  avgCost: number; avgAtSwitch: number; lastBuy: number;
  exitPrice: number | null; profit: number; maxDrawdownPct: number;
};

async function main() {
  const startMs = Date.parse(`${START}T00:00:00Z`);
  const endMs = Date.parse(`${END}T23:59:59Z`);
  const candles = await fetchKlines(SYMBOL, '1d', startMs, endMs);
  if (candles.length === 0) { console.log('No data.'); return; }

  console.log(`\n=== GRID → DAILY HYBRID DCA — ${SYMBOL} ===`);
  console.log(`Period    : ${day(candles[0]!.openTime)} → ${day(candles[candles.length - 1]!.openTime)} (${candles.length} days)`);
  console.log(`Phase 1   : $${fmt(USD_PER_BUY)} every $${fmt(STEP, 0)} drop below the last buy`);
  console.log(`Switch    : when price ≤ cycle anchor × ${fmt(1 - SWITCH_PCT, 2)} (−${fmt(SWITCH_PCT * 100, 0)}%) → buy DAILY for the rest of the cycle`);
  console.log(`Exit      : sell 100% at avgCost × ${fmt(1 + TP_PCT, 2)}; next day = new cycle; no SL`);
  console.log(`Fill model: ${MODE}   Fee: ${fmt(FEE * 100, 3)}%/side\n`);

  const cycles: Cycle[] = [];
  let cur: Cycle | null = null;

  const buy = (c: Cycle, price: number, isGrid: boolean) => {
    const q = (USD_PER_BUY * (1 - FEE)) / price;
    c.buys += 1; c.invested += USD_PER_BUY; c.qty += q;
    if (isGrid) { c.gridBuys += 1; c.gridInvested += USD_PER_BUY; c.gridQty += q; } else { c.dailyBuys += 1; }
    c.avgCost = c.invested / c.qty;
    c.lastBuy = price;
  };

  for (const c of candles) {
    if (!cur) {
      cur = {
        startDate: day(c.openTime), endDate: null, days: 0,
        anchor: c.open, switchPrice: c.open * (1 - SWITCH_PCT), switchDate: null,
        buys: 0, gridBuys: 0, dailyBuys: 0, invested: 0, gridInvested: 0, qty: 0, gridQty: 0,
        avgCost: 0, avgAtSwitch: 0, lastBuy: Infinity, exitPrice: null, profit: 0, maxDrawdownPct: 0,
      };
      buy(cur, c.open, true);
    } else if (cur.switchDate) {
      buy(cur, c.open, false); // phase 2: every day, no condition
    } else {
      if (MODE === 'touch') {
        while (c.low <= cur.lastBuy - STEP) buy(cur, cur.lastBuy - STEP, true);
      } else if (c.close <= cur.lastBuy - STEP) {
        buy(cur, c.close, true);
      }
    }

    // Flip to daily once price has taken out the -switchPct level.
    if (!cur.switchDate) {
      const touched = MODE === 'touch' ? c.low <= cur.switchPrice : c.close <= cur.switchPrice;
      if (touched) { cur.switchDate = day(c.openTime); cur.avgAtSwitch = cur.avgCost; }
    }

    cur.maxDrawdownPct = Math.min(cur.maxDrawdownPct, (c.low * cur.qty - cur.invested) / cur.invested * 100);

    const target = cur.avgCost * (1 + TP_PCT);
    const hit = MODE === 'touch' ? c.high >= target : c.close >= target;
    if (hit) {
      const exit = MODE === 'touch' ? target : c.close;
      cur.exitPrice = exit;
      cur.profit = cur.qty * exit * (1 - FEE) - cur.invested;
      cur.endDate = day(c.openTime);
      cur.days = Math.round((Date.parse(cur.endDate) - Date.parse(cur.startDate)) / 86400000) + 1;
      cycles.push(cur);
      cur = null;
    }
  }

  const last = candles[candles.length - 1]!;
  const open = cur;

  console.log('#    start        end          days  grid  daily   invested    avgCost     target      exit        profit     ROI%   switched');
  console.log('-'.repeat(132));
  for (let i = 0; i < cycles.length; i++) {
    const cy = cycles[i]!;
    console.log(
      `${String(i + 1).padEnd(4)} ${cy.startDate}   ${cy.endDate}   ${String(cy.days).padStart(4)}  ${String(cy.gridBuys).padStart(4)}  ${String(cy.dailyBuys).padStart(5)}   ` +
      `${('$' + fmt(cy.invested)).padStart(9)}   ${fmt(cy.avgCost).padStart(9)}   ${fmt(cy.avgCost * (1 + TP_PCT)).padStart(9)}   ${fmt(cy.exitPrice!).padStart(9)}   ` +
      `${('$' + fmt(cy.profit)).padStart(8)}   ${fmt(cy.profit / cy.invested * 100).padStart(5)}   ${cy.switchDate ?? '—'}`,
    );
  }
  if (open) {
    const mtm = open.qty * last.close;
    console.log(
      `OPEN ${open.startDate}   (running)    ${String(Math.round((Date.parse(day(last.openTime)) - Date.parse(open.startDate)) / 86400000) + 1).padStart(4)}  ` +
      `${String(open.gridBuys).padStart(4)}  ${String(open.dailyBuys).padStart(5)}   ${('$' + fmt(open.invested)).padStart(9)}   ${fmt(open.avgCost).padStart(9)}   ` +
      `${fmt(open.avgCost * (1 + TP_PCT)).padStart(9)}   ${fmt(last.close).padStart(9)}   ${('$' + fmt(mtm - open.invested)).padStart(8)}   ` +
      `${fmt((mtm - open.invested) / open.invested * 100).padStart(5)}   ${open.switchDate ?? '—'}`,
    );
  }

  const closedProfit = cycles.reduce((s, c) => s + c.profit, 0);
  const totalInvested = cycles.reduce((s, c) => s + c.invested, 0) + (open?.invested ?? 0);
  const peakCapital = Math.max(...cycles.map((c) => c.invested), open?.invested ?? 0);
  const openPnl = open ? open.qty * last.close - open.invested : 0;
  const net = closedProfit + openPnl;

  console.log('\n--- SUMMARY ---');
  console.log(`Cycles closed in profit  : ${cycles.length}   (switched to daily: ${cycles.filter((c) => c.switchDate).length})`);
  console.log(`Realised profit          : $${fmt(closedProfit)}`);
  console.log(`Peak capital in one cycle: $${fmt(peakCapital)}`);
  console.log(`Total cash put in        : $${fmt(totalInvested)}`);
  console.log(`Net P/L (realised + open): $${fmt(net)}`);
  console.log(`Return on cash deployed  : ${fmt(net / totalInvested * 100)}%`);

  if (open) {
    console.log('\n--- OPEN BAG (the one that matters) ---');
    console.log(`Cycle start       : ${open.startDate}   anchor $${fmt(open.anchor)}`);
    console.log(`Switch level      : $${fmt(open.switchPrice)}  → ${open.switchDate ? `HIT on ${open.switchDate}` : 'never hit (still on the grid)'}`);
    if (open.switchDate) {
      const gridAvg = open.gridQty > 0 ? open.gridInvested / open.gridQty : 0;
      const dailyInv = open.invested - open.gridInvested;
      const dailyQty = open.qty - open.gridQty;
      console.log(`  phase 1 (grid)  : ${open.gridBuys} buys, $${fmt(open.gridInvested)}, avg $${fmt(gridAvg)}`);
      console.log(`  phase 2 (daily) : ${open.dailyBuys} buys, $${fmt(dailyInv)}, avg $${fmt(dailyQty > 0 ? dailyInv / dailyQty : 0)}`);
      console.log(`  avg at switch   : $${fmt(open.avgAtSwitch)}  →  avg now $${fmt(open.avgCost)}  (pulled down $${fmt(open.avgAtSwitch - open.avgCost)})`);
    }
    console.log(`Position          : ${open.buys} buys, $${fmt(open.invested)} in, avg $${fmt(open.avgCost)}`);
    console.log(`Last close        : $${fmt(last.close)}   unrealised $${fmt(openPnl)} (${fmt(openPnl / open.invested * 100)}%)`);
    console.log(`Break-even needs  : +${fmt((open.avgCost / last.close - 1) * 100)}%`);
    console.log(`TP target         : $${fmt(open.avgCost * (1 + TP_PCT))}  → +${fmt((open.avgCost * (1 + TP_PCT) / last.close - 1) * 100)}% from here`);
    console.log(`Worst DD in cycle : ${fmt(open.maxDrawdownPct, 1)}%`);
  }
  console.log('');
}

void main();
