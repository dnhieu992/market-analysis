/**
 * Backtest: GRID DCA — buy $X every time price falls a fixed DOLLAR step below the last buy
 *           → take profit when price is +tp% above avg cost → restart the cycle.
 *
 * Rule:
 *   - A cycle opens with one buy at the daily OPEN.
 *   - After that, a new buy fires whenever price trades `step` dollars BELOW the last buy price.
 *     Rising price never buys. There is no time component at all — only price.
 *   - Sell 100% when price reaches avgCost × (1 + tp); the next day opens a fresh cycle.
 *   - No stop-loss. Spot. Fee on both sides.
 *
 * Fill model (`mode`):
 *   - `touch` — resting limit orders. Inside one day, EVERY grid level between the last buy and
 *     the daily LOW fills (a −$200 day fills 4 levels at step 50). TP fills when the daily HIGH
 *     reaches the target. Buys are processed before the TP check.
 *   - `close`  — a manual once-a-day check at the daily CLOSE: at most ONE buy per day (if
 *     close ≤ lastBuy − step) and TP only if close ≥ target.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-price-step-dca-tp-backtest.ts [symbol] [start] [end] [usdPerBuy] [stepUsd] [tpPct] [feePctPerSide] [mode]
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;

const SYMBOL = (process.argv[2] ?? 'ETHUSDT').toUpperCase();
const START = process.argv[3] ?? '2025-01-01';
const END = process.argv[4] ?? new Date().toISOString().slice(0, 10);
const USD_PER_BUY = Number(process.argv[5] ?? 10);
const STEP = Number(process.argv[6] ?? 50);
const TP_PCT = Number(process.argv[7] ?? 15) / 100;
const FEE = Number(process.argv[8] ?? 0.05) / 100;
const MODE = (process.argv[9] ?? 'touch') as 'touch' | 'close';

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
  startDate: string;
  endDate: string | null;
  days: number;
  buys: number;
  invested: number;
  qty: number;
  avgCost: number;
  lastBuy: number;
  exitPrice: number | null;
  profit: number;
  maxDrawdownPct: number;
  maxBuysInADay: number;
};

async function main() {
  const startMs = Date.parse(`${START}T00:00:00Z`);
  const endMs = Date.parse(`${END}T23:59:59Z`);
  const candles = await fetchKlines(SYMBOL, '1d', startMs, endMs);
  if (candles.length === 0) { console.log('No data.'); return; }

  console.log(`\n=== PRICE-STEP GRID DCA + AVG-COST TP — ${SYMBOL} ===`);
  console.log(`Period    : ${day(candles[0]!.openTime)} → ${day(candles[candles.length - 1]!.openTime)} (${candles.length} days)`);
  console.log(`Buy rule  : $${fmt(USD_PER_BUY)} every time price drops $${fmt(STEP, 0)} below the last buy (no time trigger)`);
  console.log(`Exit rule : sell 100% when price ≥ avgCost × ${fmt(1 + TP_PCT, 2)}; next day = new cycle; no SL`);
  console.log(`Fill model: ${MODE === 'touch' ? 'resting limit orders — all levels down to the daily LOW fill; TP on daily HIGH' : 'once-a-day check at the CLOSE — max 1 buy/day; TP on close'}`);
  console.log(`Fee       : ${fmt(FEE * 100, 3)}%/side\n`);

  const cycles: Cycle[] = [];
  let cur: Cycle | null = null;

  const buy = (c: Cycle, price: number) => {
    c.buys += 1;
    c.invested += USD_PER_BUY;
    c.qty += (USD_PER_BUY * (1 - FEE)) / price;
    c.avgCost = c.invested / c.qty;
    c.lastBuy = price;
  };

  for (const c of candles) {
    if (!cur) {
      cur = {
        startDate: day(c.openTime), endDate: null, days: 0, buys: 0, invested: 0, qty: 0,
        avgCost: 0, lastBuy: Infinity, exitPrice: null, profit: 0, maxDrawdownPct: 0, maxBuysInADay: 0,
      };
      buy(cur, c.open); // cycle always opens with one buy at the open
      cur.maxBuysInADay = 1;
    } else if (MODE === 'touch') {
      // Every grid level between the last buy and today's low fills.
      let n = 0;
      while (c.low <= cur.lastBuy - STEP) { buy(cur, cur.lastBuy - STEP); n += 1; }
      cur.maxBuysInADay = Math.max(cur.maxBuysInADay, n);
    } else {
      if (c.close <= cur.lastBuy - STEP) { buy(cur, c.close); cur.maxBuysInADay = Math.max(cur.maxBuysInADay, 1); }
    }

    const worst = (c.low * cur.qty - cur.invested) / cur.invested * 100;
    cur.maxDrawdownPct = Math.min(cur.maxDrawdownPct, worst);

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

  console.log('#    start        end          days   buys   invested    avgCost     target      exit        profit     ROI%    worstDD%');
  console.log('-'.repeat(124));
  for (let i = 0; i < cycles.length; i++) {
    const cy = cycles[i]!;
    console.log(
      `${String(i + 1).padEnd(4)} ${cy.startDate}   ${cy.endDate}   ${String(cy.days).padStart(4)}   ${String(cy.buys).padStart(4)}   ` +
      `${('$' + fmt(cy.invested)).padStart(9)}   ${fmt(cy.avgCost).padStart(9)}   ${fmt(cy.avgCost * (1 + TP_PCT)).padStart(9)}   ${fmt(cy.exitPrice!).padStart(9)}   ` +
      `${('$' + fmt(cy.profit)).padStart(8)}   ${fmt(cy.profit / cy.invested * 100).padStart(5)}   ${fmt(cy.maxDrawdownPct, 1).padStart(7)}`,
    );
  }
  if (open) {
    const mtm = open.qty * last.close;
    console.log(
      `OPEN ${open.startDate}   (running)    ${String(Math.round((Date.parse(day(last.openTime)) - Date.parse(open.startDate)) / 86400000) + 1).padStart(4)}   ` +
      `${String(open.buys).padStart(4)}   ${('$' + fmt(open.invested)).padStart(9)}   ${fmt(open.avgCost).padStart(9)}   ${fmt(open.avgCost * (1 + TP_PCT)).padStart(9)}   ` +
      `${fmt(last.close).padStart(9)}   ${('$' + fmt(mtm - open.invested)).padStart(8)}   ${fmt((mtm - open.invested) / open.invested * 100).padStart(5)}   ${fmt(open.maxDrawdownPct, 1).padStart(7)}`,
    );
  }

  const closedProfit = cycles.reduce((s, c) => s + c.profit, 0);
  const closedInvested = cycles.reduce((s, c) => s + c.invested, 0);
  const totalBuys = cycles.reduce((s, c) => s + c.buys, 0) + (open?.buys ?? 0);
  const totalInvested = closedInvested + (open?.invested ?? 0);
  const longest = cycles.reduce<Cycle | null>((a, b) => (!a || b.days > a.days ? b : a), null);
  const peakCapital = Math.max(...cycles.map((c) => c.invested), open?.invested ?? 0);
  const openPnl = open ? open.qty * last.close - open.invested : 0;
  const net = closedProfit + openPnl;

  console.log('\n--- SUMMARY ---');
  console.log(`Cycles closed in profit  : ${cycles.length}`);
  console.log(`Realised profit          : $${fmt(closedProfit)}  (on $${fmt(closedInvested)} deployed across closed cycles)`);
  if (longest) console.log(`Longest cycle            : ${longest.days} days  (${longest.startDate} → ${longest.endDate}, ${longest.buys} buys, $${fmt(longest.invested)} in)`);
  if (cycles.length) console.log(`Average cycle            : ${fmt(cycles.reduce((s, c) => s + c.days, 0) / cycles.length, 1)} days`);
  console.log(`Peak capital in one cycle: $${fmt(peakCapital)}`);
  console.log(`Total buys               : ${totalBuys} over ${candles.length} days (${fmt(totalBuys / candles.length, 2)} buys/day)`);
  console.log(`Total cash put in        : $${fmt(totalInvested)}  (daily-DCA baseline puts in $${fmt(candles.length * USD_PER_BUY)})`);
  if (open) {
    console.log(`Open cycle at end        : ${open.buys} buys, $${fmt(open.invested)} in, avg ${fmt(open.avgCost)}, needs ${fmt(open.avgCost * (1 + TP_PCT))} (last close ${fmt(last.close)}, ${fmt((open.avgCost * (1 + TP_PCT) / last.close - 1) * 100)}% away) → unrealised $${fmt(openPnl)} (${fmt(openPnl / open.invested * 100)}%)`);
  }
  console.log(`Net P/L (realised + open): $${fmt(net)}`);
  console.log(`Return on cash deployed  : ${fmt(net / totalInvested * 100)}%\n`);
}

void main();
