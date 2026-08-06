/**
 * Backtest: DAILY FIXED-$ DCA → take profit when price is +X% above AVERAGE COST → restart.
 *
 * The user's flow:
 *   - Every day, buy a fixed USD amount (default $10) at the daily OPEN (00:00 UTC).
 *   - Hold everything. As soon as price reaches avgCost × (1 + tpPct), SELL THE WHOLE bag.
 *   - The cycle ends that day; the next day starts a fresh cycle (avg cost resets).
 *   - No stop-loss. Spot. Fee charged on both sides.
 *
 * TP fill model (`tpMode`):
 *   - `touch` (default) — a resting limit sell at the target fills the moment the daily HIGH
 *     reaches it, at exactly the target price.
 *   - `close`           — only exits if the daily CLOSE is at/above the target, filling at the
 *     close (a manual "check once a day" trader). Strictly more conservative.
 *
 * Note the buy on the exit day still happens: the 00:00 buy lands before the intraday TP.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-daily-dca-tp-cycle-backtest.ts [symbol] [startDate] [endDate] [dailyUsd] [tpPct] [feePctPerSide] [tpMode]
 *
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-daily-dca-tp-cycle-backtest.ts ETHUSDT 2025-01-01 2026-08-04 10 15 0.05 touch
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
  buys: number;
  invested: number;
  qty: number;
  avgCost: number;
  target: number;
  exitPrice: number | null;
  proceeds: number;
  profit: number;
  days: number;
  peakInvested: number;
  maxDrawdownPct: number; // worst mark-to-market on invested capital inside the cycle
};

async function main() {
  const startMs = Date.parse(`${START}T00:00:00Z`);
  const endMs = Date.parse(`${END}T23:59:59Z`);
  const candles = await fetchKlines(SYMBOL, '1d', startMs, endMs);
  if (candles.length === 0) { console.log('No data.'); return; }

  console.log(`\n=== DAILY DCA + AVG-COST TAKE PROFIT — ${SYMBOL} ===`);
  console.log(`Period      : ${day(candles[0]!.openTime)} → ${day(candles[candles.length - 1]!.openTime)} (${candles.length} days)`);
  console.log(`Rule        : buy $${fmt(DAILY_USD)} at every daily open; sell 100% when price ≥ avgCost × ${fmt(1 + TP_PCT, 2)}; next day = new cycle`);
  console.log(`TP fill     : ${TP_MODE === 'touch' ? 'intraday touch of the target (resting limit sell)' : 'daily close at/above the target (manual once-a-day check)'}`);
  console.log(`Fee         : ${fmt(FEE * 100, 3)}%/side\n`);

  const cycles: Cycle[] = [];
  let cur: Cycle | null = null;

  for (const c of candles) {
    if (!cur) {
      cur = {
        startDate: day(c.openTime), endDate: null, buys: 0, invested: 0, qty: 0,
        avgCost: 0, target: 0, exitPrice: null, proceeds: 0, profit: 0, days: 0,
        peakInvested: 0, maxDrawdownPct: 0,
      };
    }

    // 1. Daily buy at the open.
    cur.buys += 1;
    cur.invested += DAILY_USD;
    cur.qty += (DAILY_USD * (1 - FEE)) / c.open;
    cur.avgCost = cur.invested / cur.qty;
    cur.target = cur.avgCost * (1 + TP_PCT);
    cur.peakInvested = Math.max(cur.peakInvested, cur.invested);

    // Worst unrealised loss inside the cycle, measured on money already in.
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
      cur = null; // next candle opens a fresh cycle
    }
  }

  const last = candles[candles.length - 1]!;
  const open = cur; // unfinished cycle still holding at the end of the data

  // ---- per-cycle table ----
  console.log('#    start        end          days   buys   invested    avgCost     target      exit        profit     ROI%    worstDD%');
  console.log('-'.repeat(122));
  for (let i = 0; i < cycles.length; i++) {
    const cy = cycles[i]!;
    console.log(
      `${String(i + 1).padEnd(4)} ${cy.startDate}   ${cy.endDate}   ${String(cy.days).padStart(4)}   ${String(cy.buys).padStart(4)}   ` +
      `${('$' + fmt(cy.invested)).padStart(9)}   ${fmt(cy.avgCost).padStart(9)}   ${fmt(cy.target).padStart(9)}   ${fmt(cy.exitPrice!).padStart(9)}   ` +
      `${('$' + fmt(cy.profit)).padStart(8)}   ${fmt(cy.profit / cy.invested * 100).padStart(5)}   ${fmt(cy.maxDrawdownPct, 1).padStart(7)}`,
    );
  }
  if (open) {
    const mtm = open.qty * last.close;
    console.log(
      `OPEN ${open.startDate}   (running)    ${String(Math.round((Date.parse(day(last.openTime)) - Date.parse(open.startDate)) / 86400000) + 1).padStart(4)}   ` +
      `${String(open.buys).padStart(4)}   ${('$' + fmt(open.invested)).padStart(9)}   ${fmt(open.avgCost).padStart(9)}   ${fmt(open.target).padStart(9)}   ` +
      `${fmt(last.close).padStart(9)}   ${('$' + fmt(mtm - open.invested)).padStart(8)}   ${fmt((mtm - open.invested) / open.invested * 100).padStart(5)}   ${fmt(open.maxDrawdownPct, 1).padStart(7)}`,
    );
  }

  // ---- summary ----
  const closedProfit = cycles.reduce((s, c) => s + c.profit, 0);
  const totalInvested = cycles.reduce((s, c) => s + c.invested, 0) + (open?.invested ?? 0);
  const longest = cycles.reduce<Cycle | null>((a, b) => (!a || b.days > a.days ? b : a), null);
  const shortest = cycles.reduce<Cycle | null>((a, b) => (!a || b.days < a.days ? b : a), null);
  const peakCapital = Math.max(...cycles.map((c) => c.peakInvested), open?.peakInvested ?? 0);
  const openMtm = open ? open.qty * last.close : 0;
  const openPnl = open ? openMtm - open.invested : 0;

  console.log('\n--- SUMMARY ---');
  console.log(`Cycles closed in profit : ${cycles.length}`);
  console.log(`Realised profit         : $${fmt(closedProfit)}  (on $${fmt(cycles.reduce((s, c) => s + c.invested, 0))} deployed across closed cycles)`);
  if (longest) console.log(`Longest cycle           : ${longest.days} days  (${longest.startDate} → ${longest.endDate}, ${longest.buys} buys, $${fmt(longest.invested)} in)`);
  if (shortest) console.log(`Shortest cycle          : ${shortest.days} days  (${shortest.startDate} → ${shortest.endDate})`);
  if (cycles.length) console.log(`Average cycle           : ${fmt(cycles.reduce((s, c) => s + c.days, 0) / cycles.length, 1)} days`);
  console.log(`Peak capital in one cycle: $${fmt(peakCapital)}`);
  console.log(`Total cash put in        : $${fmt(totalInvested)} (${candles.length} daily buys)`);
  if (open) {
    console.log(`Open cycle at end        : ${open.buys} buys, $${fmt(open.invested)} in, avg ${fmt(open.avgCost)}, needs ${fmt(open.target)} (last close ${fmt(last.close)}) → unrealised $${fmt(openPnl)} (${fmt(openPnl / open.invested * 100)}%)`);
  }
  console.log(`Net P/L (realised + open): $${fmt(closedProfit + openPnl)}\n`);
}

void main();
