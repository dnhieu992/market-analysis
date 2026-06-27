/**
 * Compounded vs FLAT ($1000 fixed per cycle) sizing, for the same DCA dip-bounce configs.
 *
 *  - COMPOUNDED: each cycle deploys a fraction of the CURRENT equity (profits reinvested).
 *  - FLAT      : each cycle always works with a fixed $1000 budget; realised profit is banked to
 *                the side and NOT reinvested. Total return = sum of per-cycle PnL / $1000.
 *
 * FAIR fill model + 0.05% slippage. IS 2017-2022, OOS 2023-2026. Buy&Hold shown for reference
 * (B&H is inherently compounded — a single position that grows).
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-btc-dca-compound-vs-flat.ts [symbol]
 */
import * as https from 'https';
const HOST = 'https://api.binance.com/api/v3/klines';
const FEE = 0.0005, SLIP = 0.0005, CAPITAL = 1000;
type Candle = { open: number; high: number; low: number; close: number; openTime: Date };
function fetchJson(url: string): Promise<unknown[]> {
  return new Promise((res, rej) => { https.get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej); });
}
async function fetchKlines(symbol: string, interval: string, s: number, e: number): Promise<Candle[]> {
  const out: Candle[] = []; let cur = s;
  while (cur < e) {
    const b = (await fetchJson(`${HOST}?symbol=${symbol}&interval=${interval}&startTime=${cur}&endTime=${e}&limit=1000`)) as unknown[][];
    if (!Array.isArray(b) || !b.length) break;
    for (const k of b) out.push({ open: +(k[1] as string), high: +(k[2] as string), low: +(k[3] as string), close: +(k[4] as string), openTime: new Date(k[0] as number) });
    if (b.length < 1000) break; cur = (b[b.length - 1]![0] as number) + 1;
  }
  return out;
}
const D = (d: Date) => d.toISOString().slice(0, 10);
type Cfg = { tiers: number[]; tp: number; name: string };

// COMPOUNDED: cycle budget = current cash (profits reinvested).
function runCompound(candles: Candle[], cfg: Cfg): { retPct: number; cycles: number } {
  const alloc = 1 / cfg.tiers.length;
  let cash = CAPITAL, btc = 0, avgCost = 0, invested = 0;
  let peak = candles[0]!.high, cycleCash = cash;
  const fired = new Set<number>(); let inPos = false, cycles = 0;
  for (const c of candles) {
    if (!inPos) peak = Math.max(peak, c.high);
    if (inPos && btc > 0) {
      const tp = avgCost * (1 + cfg.tp / 100);
      if (c.high >= tp) { cash += btc * tp * (1 - SLIP) * (1 - FEE); btc = 0; invested = 0; avgCost = 0; inPos = false; fired.clear(); peak = c.high; cycles++; }
    }
    for (let t = 0; t < cfg.tiers.length; t++) {
      if (fired.has(t)) continue;
      const level = peak * (1 - cfg.tiers[t]! / 100);
      if (c.low <= level) {
        if (!inPos) { cycleCash = cash; inPos = true; }
        const spend = Math.min(alloc * cycleCash, cash);
        if (spend > 0) { const fill = level * (1 + SLIP); btc += (spend * (1 - FEE)) / fill; invested += spend; avgCost = invested / btc; cash -= spend; fired.add(t); }
      }
    }
  }
  const finalEquity = cash + btc * candles[candles.length - 1]!.close;
  return { retPct: (finalEquity / CAPITAL - 1) * 100, cycles };
}

// FLAT: every cycle uses a fixed $1000 budget; realised PnL banked aside, not reinvested.
function runFlat(candles: Candle[], cfg: Cfg): { retPct: number; cycles: number } {
  const alloc = 1 / cfg.tiers.length;
  let realized = 0;            // banked profit/loss in $
  let btc = 0, avgCost = 0, invested = 0, spentThisCycle = 0;
  let peak = candles[0]!.high;
  const fired = new Set<number>(); let inPos = false, cycles = 0;
  for (const c of candles) {
    if (!inPos) peak = Math.max(peak, c.high);
    if (inPos && btc > 0) {
      const tp = avgCost * (1 + cfg.tp / 100);
      if (c.high >= tp) {
        const proceeds = btc * tp * (1 - SLIP) * (1 - FEE);
        realized += proceeds - spentThisCycle; // profit of this cycle only
        btc = 0; invested = 0; avgCost = 0; spentThisCycle = 0; inPos = false; fired.clear(); peak = c.high; cycles++;
      }
    }
    for (let t = 0; t < cfg.tiers.length; t++) {
      if (fired.has(t)) continue;
      const level = peak * (1 - cfg.tiers[t]! / 100);
      if (c.low <= level) {
        if (!inPos) { inPos = true; }
        const budgetLeft = CAPITAL - spentThisCycle;       // fixed $1000 budget per cycle
        const spend = Math.min(alloc * CAPITAL, budgetLeft);
        if (spend > 0) { const fill = level * (1 + SLIP); btc += (spend * (1 - FEE)) / fill; invested += spend; avgCost = invested / btc; spentThisCycle += spend; fired.add(t); }
      }
    }
  }
  // mark any open position to market at the end
  if (inPos && btc > 0) realized += btc * candles[candles.length - 1]!.close - spentThisCycle;
  return { retPct: realized / CAPITAL * 100, cycles };
}

function bh(candles: Candle[]): number {
  const qty = (CAPITAL * (1 - FEE)) / (candles[0]!.close * (1 + SLIP));
  return (qty * candles[candles.length - 1]!.close / CAPITAL - 1) * 100;
}
const tf = (s: number, st: number, n: number) => Array.from({ length: n }, (_, i) => +(s + i * st).toFixed(1));

async function main() {
  const symbol = process.argv[2] ?? 'BTCUSDT';
  const all = await fetchKlines(symbol, '1d', Date.UTC(2017, 0, 1), Date.now());
  const IS = all.filter((c) => c.openTime.getTime() < Date.UTC(2023, 0, 1));
  const OOS = all.filter((c) => c.openTime.getTime() >= Date.UTC(2023, 0, 1));
  console.log(`${symbol}.  Buy&Hold: IS +${bh(IS).toFixed(0)}%  OOS +${bh(OOS).toFixed(0)}%  (B&H always compounds)\n`);

  const cfgs: Cfg[] = [
    { tiers: tf(5, 1.5, 10), tp: 10, name: '10x start-5 step1.5' },
    { tiers: tf(5, 2, 8), tp: 10, name: 'robust 8x start-5 step2' },
    { tiers: [5, 9, 13, 17], tp: 10, name: '4x start-5' },
  ];

  console.log('config                       ||  IS compounded |  IS flat$1000  ||  OOS compounded | OOS flat$1000');
  for (const cfg of cfgs) {
    const ic = runCompound(IS, cfg), iflat = runFlat(IS, cfg);
    const oc = runCompound(OOS, cfg), oflat = runFlat(OOS, cfg);
    console.log(
      `${cfg.name.padEnd(28)} ||  ${('+' + ic.retPct.toFixed(0) + '%').padStart(12)} | ${('+' + iflat.retPct.toFixed(0) + '%').padStart(12)}  ||  ${('+' + oc.retPct.toFixed(0) + '%').padStart(13)} | ${('+' + oflat.retPct.toFixed(0) + '%').padStart(12)}`,
    );
  }
  console.log('\n(flat$1000 = each cycle limited to a $1000 budget; profits banked aside, not reinvested)');
}
main().catch((e) => { console.error(e); process.exit(1); });
