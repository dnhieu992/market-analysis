/**
 * Backtest: DAILY $ DCA **only when price is below the current average cost**
 *           → take profit when price is +X% above avg cost → restart the cycle.
 *
 * Same flow as `run-daily-dca-tp-cycle-backtest.ts`, plus ONE new rule:
 *   - The daily $10 buy only fires when the buy price (daily open) is BELOW the
 *     current avgCost of the open bag. The very first buy of a cycle always fires
 *     (there is no average yet).
 *
 * `--always` (buyFilter = "all") disables the filter so the same script reproduces
 * the baseline for a like-for-like comparison.
 *
 * TP fill model (`tpMode`):
 *   - `touch` — a resting limit sell at the target fills when the daily HIGH reaches it.
 *   - `close` — exits only if the daily CLOSE is at/above the target, filling at the close.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-daily-dca-belowavg-tp-backtest.ts [symbol] [start] [end] [dailyUsd] [tpPct] [feePctPerSide] [tpMode] [buyFilter]
 *
 *   buyFilter: "below" (default, only buy under avg) | "all" (baseline)
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;

const SYMBOL = (process.argv[2] ?? 'ETHUSDT').toUpperCase();
const START = process.argv[3] ?? '2025-01-01';
const END = process.argv[4] ?? new Date().toISOString().slice(0, 10);
const DAILY_USD = Number(process.argv[5] ?? 10);
const TP_PCT = Number(process.argv[6] ?? 15) / 100;
const FEE = Number(process.argv[7] ?? 0.05) / 100;
const TP_MODE = (process.argv[8] ?? 'touch') as 'touch' | 'close';
const BUY_FILTER = (process.argv[9] ?? 'below') as 'below' | 'all';

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
  daysElapsed: number;   // calendar days in the cycle (incl. skipped days)
  buys: number;
  skipped: number;
  invested: number;
  qty: number;
  avgCost: number;
  target: number;
  exitPrice: number | null;
  proceeds: number;
  profit: number;
  peakInvested: number;
  maxDrawdownPct: number;
};

async function main() {
  const startMs = Date.parse(`${START}T00:00:00Z`);
  const endMs = Date.parse(`${END}T23:59:59Z`);
  const candles = await fetchKlines(SYMBOL, '1d', startMs, endMs);
  if (candles.length === 0) { console.log('No data.'); return; }

  console.log(`\n=== DAILY DCA (buy only under avg) + AVG-COST TP — ${SYMBOL} ===`);
  console.log(`Period      : ${day(candles[0]!.openTime)} → ${day(candles[candles.length - 1]!.openTime)} (${candles.length} days)`);
  console.log(`Buy rule    : ${BUY_FILTER === 'below' ? `$${fmt(DAILY_USD)} at the daily open ONLY IF open < avgCost (first buy of a cycle always fires)` : `$${fmt(DAILY_USD)} at every daily open (baseline, no filter)`}`);
  console.log(`Exit rule   : sell 100% when price ≥ avgCost × ${fmt(1 + TP_PCT, 2)}; next day = new cycle; no SL`);
  console.log(`TP fill     : ${TP_MODE === 'touch' ? 'intraday touch of the target (resting limit sell)' : 'daily close at/above the target'}`);
  console.log(`Fee         : ${fmt(FEE * 100, 3)}%/side\n`);

  const cycles: Cycle[] = [];
  let cur: Cycle | null = null;
  let totalSkipped = 0;

  for (const c of candles) {
    if (!cur) {
      cur = {
        startDate: day(c.openTime), endDate: null, days: 0, daysElapsed: 0, buys: 0, skipped: 0,
        invested: 0, qty: 0, avgCost: 0, target: 0, exitPrice: null, proceeds: 0, profit: 0,
        peakInvested: 0, maxDrawdownPct: 0,
      };
    }
    cur.daysElapsed += 1;

    // 1. Daily buy at the open — gated on price being below the running average cost.
    const shouldBuy = BUY_FILTER === 'all' || cur.qty === 0 || c.open < cur.avgCost;
    if (shouldBuy) {
      cur.buys += 1;
      cur.invested += DAILY_USD;
      cur.qty += (DAILY_USD * (1 - FEE)) / c.open;
      cur.avgCost = cur.invested / cur.qty;
      cur.target = cur.avgCost * (1 + TP_PCT);
      cur.peakInvested = Math.max(cur.peakInvested, cur.invested);
    } else {
      cur.skipped += 1;
      totalSkipped += 1;
    }

    const worst = (c.low * cur.qty - cur.invested) / cur.invested * 100;
    cur.maxDrawdownPct = Math.min(cur.maxDrawdownPct, worst);

    // 2. Take profit?
    const hit = TP_MODE === 'touch' ? c.high >= cur.target : c.close >= cur.target;
    if (hit) {
      const exit = TP_MODE === 'touch' ? cur.target : c.close;
      cur.exitPrice = exit;
      cur.proceeds = cur.qty * exit * (1 - FEE);
      cur.profit = cur.proceeds - cur.invested;
      cur.endDate = day(c.openTime);
      cur.days = Math.round((Date.parse(cur.endDate) - Date.parse(cur.startDate)) / 86400000) + 1;
      cycles.push(cur);
      cur = null;
    }
  }

  const last = candles[candles.length - 1]!;
  const open = cur;

  console.log('#    start        end          days   buys  skip   invested    avgCost     target      exit        profit     ROI%    worstDD%');
  console.log('-'.repeat(130));
  for (let i = 0; i < cycles.length; i++) {
    const cy = cycles[i]!;
    console.log(
      `${String(i + 1).padEnd(4)} ${cy.startDate}   ${cy.endDate}   ${String(cy.days).padStart(4)}   ${String(cy.buys).padStart(4)}  ${String(cy.skipped).padStart(4)}   ` +
      `${('$' + fmt(cy.invested)).padStart(9)}   ${fmt(cy.avgCost).padStart(9)}   ${fmt(cy.target).padStart(9)}   ${fmt(cy.exitPrice!).padStart(9)}   ` +
      `${('$' + fmt(cy.profit)).padStart(8)}   ${fmt(cy.profit / cy.invested * 100).padStart(5)}   ${fmt(cy.maxDrawdownPct, 1).padStart(7)}`,
    );
  }
  if (open) {
    const mtm = open.qty * last.close;
    console.log(
      `OPEN ${open.startDate}   (running)    ${String(open.daysElapsed).padStart(4)}   ${String(open.buys).padStart(4)}  ${String(open.skipped).padStart(4)}   ` +
      `${('$' + fmt(open.invested)).padStart(9)}   ${fmt(open.avgCost).padStart(9)}   ${fmt(open.target).padStart(9)}   ` +
      `${fmt(last.close).padStart(9)}   ${('$' + fmt(mtm - open.invested)).padStart(8)}   ${fmt((mtm - open.invested) / open.invested * 100).padStart(5)}   ${fmt(open.maxDrawdownPct, 1).padStart(7)}`,
    );
  }

  const closedProfit = cycles.reduce((s, c) => s + c.profit, 0);
  const closedInvested = cycles.reduce((s, c) => s + c.invested, 0);
  const totalInvested = closedInvested + (open?.invested ?? 0);
  const totalBuys = cycles.reduce((s, c) => s + c.buys, 0) + (open?.buys ?? 0);
  const longest = cycles.reduce<Cycle | null>((a, b) => (!a || b.days > a.days ? b : a), null);
  const shortest = cycles.reduce<Cycle | null>((a, b) => (!a || b.days < a.days ? b : a), null);
  const peakCapital = Math.max(...cycles.map((c) => c.peakInvested), open?.peakInvested ?? 0);
  const openMtm = open ? open.qty * last.close : 0;
  const openPnl = open ? openMtm - open.invested : 0;
  const net = closedProfit + openPnl;

  console.log('\n--- SUMMARY ---');
  console.log(`Cycles closed in profit  : ${cycles.length}`);
  console.log(`Realised profit          : $${fmt(closedProfit)}  (on $${fmt(closedInvested)} deployed across closed cycles)`);
  if (longest) console.log(`Longest cycle            : ${longest.days} days  (${longest.startDate} → ${longest.endDate}, ${longest.buys} buys / ${longest.skipped} skipped, $${fmt(longest.invested)} in)`);
  if (shortest) console.log(`Shortest cycle           : ${shortest.days} days  (${shortest.startDate} → ${shortest.endDate})`);
  if (cycles.length) console.log(`Average cycle            : ${fmt(cycles.reduce((s, c) => s + c.days, 0) / cycles.length, 1)} days`);
  console.log(`Peak capital in one cycle: $${fmt(peakCapital)}`);
  console.log(`Buys executed / skipped  : ${totalBuys} / ${totalSkipped} of ${candles.length} days (${fmt(totalBuys / candles.length * 100, 1)}% fill rate)`);
  console.log(`Total cash put in        : $${fmt(totalInvested)}  (baseline would be $${fmt(candles.length * DAILY_USD)})`);
  if (open) {
    console.log(`Open cycle at end        : ${open.daysElapsed} days, ${open.buys} buys, $${fmt(open.invested)} in, avg ${fmt(open.avgCost)}, needs ${fmt(open.target)} (last close ${fmt(last.close)}, ${fmt((open.target / last.close - 1) * 100)}% away) → unrealised $${fmt(openPnl)} (${fmt(openPnl / open.invested * 100)}%)`);
  }
  console.log(`Net P/L (realised + open): $${fmt(net)}`);
  console.log(`Return on cash deployed  : ${fmt(net / totalInvested * 100)}%\n`);
}

void main();
