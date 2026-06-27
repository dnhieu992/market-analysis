/**
 * Parameter sweep for the "Config A" DCA dip-bounce family on BTC (spot, 1d, 2017 -> now).
 *
 * Config A family = 4 equal tranches (25% of cycle cash each) bought as price falls through
 * 4 drawdown tiers below the running peak, then SELL ALL at +tp% above avg cost.
 *
 * We sweep:
 *   - start : drawdown % of the FIRST (shallowest) tier
 *   - step  : spacing between tiers (tiers = start, start+step, start+2*step, start+3*step)
 *   - tp    : take-profit % above average cost
 *
 * Ranked by final equity. We also report the same grid sorted by MAR (return per unit of max
 * drawdown) and flag robustness (mean return of the 3x3x neighbourhood) to fight overfitting.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-btc-dca-configA-sweep.ts [symbol]
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const FEE = 0.0005;
const CAPITAL = 1000;

type Candle = { open: number; high: number; low: number; close: number; openTime: Date };

function fetchJson(url: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function fetchKlines(symbol: string, interval: string, startMs: number, endMs: number): Promise<Candle[]> {
  const candles: Candle[] = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const url = `${BINANCE_HOST}?symbol=${symbol}&interval=${interval}&startTime=${cursor}&endTime=${endMs}&limit=${MAX_PER_REQ}`;
    const batch = (await fetchJson(url)) as unknown[][];
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const k of batch) {
      candles.push({
        open: parseFloat(k[1] as string), high: parseFloat(k[2] as string),
        low: parseFloat(k[3] as string), close: parseFloat(k[4] as string),
        openTime: new Date(k[0] as number),
      });
    }
    if (batch.length < MAX_PER_REQ) break;
    cursor = (batch[batch.length - 1]![0] as number) + 1;
  }
  return candles;
}

const fmtUsd = (n: number) => '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

type Params = { start: number; step: number; tp: number };
type Run = { p: Params; finalEquity: number; retPct: number; cycles: number; maxDD: number; mar: number };

// FAIR model: intraday LIMIT fills at the exact tier/TP price (low<=level buys at level;
// high>=tpLevel sells at tpLevel), but a position opened on a candle cannot be TP-sold until a
// LATER candle (TP is checked at the start of the bar, for positions held coming IN). This keeps
// realistic limit-order fills while removing the same-candle round-trip illusion.
function runDca(candles: Candle[], p: Params): Run {
  const tiers = [p.start, p.start + p.step, p.start + 2 * p.step, p.start + 3 * p.step];
  let cash = CAPITAL, btc = 0, avgCost = 0, invested = 0;
  let peak = candles[0]!.high, cycleCash = cash;
  const fired = new Set<number>();
  let inPos = false, cycles = 0;
  let equityPeak = CAPITAL, maxDD = 0;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    if (!inPos) peak = Math.max(peak, c.high);

    // TP first, for positions held coming INTO this bar (no same-bar round-trip), filled at level.
    if (inPos && btc > 0) {
      const tpLevel = avgCost * (1 + p.tp / 100);
      if (c.high >= tpLevel) {
        cash += btc * tpLevel * (1 - FEE);
        btc = 0; invested = 0; avgCost = 0; inPos = false; fired.clear();
        peak = c.high; cycles++;
      }
    }

    // Entries: a tier fires when the LOW reaches the tier level; filled at that exact level.
    for (let t = 0; t < tiers.length; t++) {
      if (fired.has(t)) continue;
      const level = peak * (1 - tiers[t]! / 100);
      if (c.low <= level) {
        if (!inPos) { cycleCash = cash; inPos = true; }
        const spend = Math.min(0.25 * cycleCash, cash);
        if (spend > 0) {
          const qty = (spend * (1 - FEE)) / level;
          btc += qty; invested += spend; avgCost = invested / btc; cash -= spend; fired.add(t);
        }
      }
    }

    const eq = cash + btc * c.close;
    equityPeak = Math.max(equityPeak, eq);
    maxDD = Math.max(maxDD, (equityPeak - eq) / equityPeak);
  }

  const finalEquity = cash + btc * candles[candles.length - 1]!.close;
  const retPct = (finalEquity / CAPITAL - 1) * 100;
  return { p, finalEquity, retPct, cycles, maxDD: maxDD * 100, mar: retPct / (maxDD * 100) };
}

async function main() {
  const symbol = process.argv[2] ?? 'BTCUSDT';
  const candles = await fetchKlines(symbol, '1d', Date.UTC(2017, 0, 1), Date.now());
  console.log(`${symbol} 1d: ${candles.length} candles (${fmtDate(candles[0]!.openTime)} -> ${fmtDate(candles[candles.length - 1]!.openTime)})`);
  console.log(`Capital $${CAPITAL}, fee ${(FEE * 100).toFixed(2)}%/side, 4 equal 25% tranches.`);
  console.log(`FILL MODEL: FAIR (intraday limit fills at exact tier/TP price, no same-candle round-trip).\n`);

  const startGrid = [5, 7, 8, 10, 12, 15];
  const stepGrid = [3, 4, 5, 7, 10];
  const tpGrid = [8, 10, 12, 15, 18, 20, 25, 30];

  const runs: Run[] = [];
  for (const start of startGrid)
    for (const step of stepGrid)
      for (const tp of tpGrid)
        runs.push(runDca(candles, { start, step, tp }));

  console.log(`Swept ${runs.length} combos (start x step x tp = ${startGrid.length}x${stepGrid.length}x${tpGrid.length}).\n`);

  // Robustness: mean return over neighbours sharing same start & step, tp +/- one grid step.
  const key = (p: Params) => `${p.start}|${p.step}|${p.tp}`;
  const map = new Map(runs.map((r) => [key(r.p), r]));
  const tpIdx = (tp: number) => tpGrid.indexOf(tp);
  const robustness = (r: Run): number => {
    const i = tpIdx(r.p.tp);
    const neigh = [tpGrid[i - 1], r.p.tp, tpGrid[i + 1]].filter((x): x is number => x != null);
    const vals = neigh.map((tp) => map.get(`${r.p.start}|${r.p.step}|${tp}`)!.retPct);
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };

  const header = 'start  step   tiers                       tp    final      ret%   cyc  maxDD%   MAR   robust(ret%)';
  const fmtRow = (r: Run) => {
    const tiers = [r.p.start, r.p.start + r.p.step, r.p.start + 2 * r.p.step, r.p.start + 3 * r.p.step].map((x) => '-' + x).join('/');
    return `${String(r.p.start).padStart(4)}  ${String(r.p.step).padStart(4)}   ${tiers.padEnd(22)}  ${String(r.p.tp).padStart(3)}  ${fmtUsd(r.finalEquity).padStart(9)}  ${(r.retPct).toFixed(0).padStart(5)}  ${String(r.cycles).padStart(3)}  ${r.maxDD.toFixed(0).padStart(5)}  ${r.mar.toFixed(1).padStart(5)}  ${robustness(r).toFixed(0).padStart(6)}`;
  };

  console.log('=== TOP 15 by final equity (return) ===');
  console.log(header);
  [...runs].sort((a, b) => b.finalEquity - a.finalEquity).slice(0, 15).forEach((r) => console.log(fmtRow(r)));

  console.log('\n=== TOP 15 by MAR (return / max drawdown) ===');
  console.log(header);
  [...runs].sort((a, b) => b.mar - a.mar).slice(0, 15).forEach((r) => console.log(fmtRow(r)));

  console.log('\n=== TOP 15 by ROBUST return (mean of tp-neighbourhood) ===');
  console.log(header);
  [...runs].sort((a, b) => robustness(b) - robustness(a)).slice(0, 15).forEach((r) => console.log(fmtRow(r)));

  console.log('\n=== Original Config A baseline (-10/15/20/25, tp+15) ===');
  console.log(header);
  console.log(fmtRow(runDca(candles, { start: 10, step: 5, tp: 15 })));
}

main().catch((e) => { console.error(e); process.exit(1); });
