/**
 * BTC "DCA the dip, sell the bounce" strategy backtest (spot, 1d candles, 2017 -> now).
 *
 * Idea (derived from the drawdown study): BTC dips of 10-30% from a local peak happen
 * constantly and usually mean-revert. So we hold cash, deploy it in TRANCHES as price
 * falls through drawdown tiers below the running peak, then SELL EVERYTHING once price
 * rebounds +tp% above our average cost ("ăn cú tăng hồi"). Then we reset and wait for
 * the next dip.
 *
 * Fills are at the exact tier / TP level (limit-order assumption), intraday via high/low.
 * Fee = 0.05%/side (repo convention). Capital compounds across cycles.
 *
 * Benchmarks printed alongside: Buy & Hold, and weekly periodic DCA.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-btc-dca-dip-bounce-backtest.ts [symbol]
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const FEE = 0.0005; // 0.05% per side
const CAPITAL = 1000;

type Candle = { open: number; high: number; low: number; close: number; openTime: Date };

function fetchJson(url: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
      })
      .on('error', reject);
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

type Tier = { dd: number; alloc: number }; // dd = drawdown trigger %, alloc = fraction of cycle cash
type Config = { name: string; tiers: Tier[]; tp: number; regimeStop?: boolean };

// Simple SMA over close, value at index i (NaN until enough data).
function sma(candles: Candle[], period: number): number[] {
  const out = new Array(candles.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i]!.close;
    if (i >= period) sum -= candles[i - period]!.close;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

type Result = {
  name: string; finalEquity: number; retPct: number; cycles: number;
  avgCycleDays: number; timeInMarketPct: number; maxEquityDD: number; endHolding: boolean;
};

function runDcaDip(candles: Candle[], cfg: Config): Result {
  const ma200 = cfg.regimeStop ? sma(candles, 200) : [];
  let cash = CAPITAL;
  let btc = 0;
  let avgCost = 0;
  let invested = 0;          // $ cost basis currently deployed
  let peak = candles[0]!.high;
  let cycleCash = cash;      // cash snapshot at the moment the first tranche of a cycle fires
  const fired = new Set<number>();
  let inPosition = false;

  let cycles = 0;
  let cycleDaysTotal = 0;
  let cycleStartIdx = 0;
  let daysInMarket = 0;
  let equityPeak = CAPITAL;
  let maxEquityDD = 0;

  const equityAt = (price: number) => cash + btc * price;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;

    if (!inPosition) {
      peak = Math.max(peak, c.high); // track running local peak while waiting
    } else {
      daysInMarket++;
    }

    const regimeUp = !cfg.regimeStop || !Number.isNaN(ma200[i]) ? (!cfg.regimeStop || c.close >= ma200[i]!) : false;

    // --- Regime exit: in a confirmed downtrend (close < 200DMA), cut and wait ---
    if (cfg.regimeStop && inPosition && !Number.isNaN(ma200[i]) && c.close < ma200[i]!) {
      cash += btc * c.close * (1 - FEE);
      btc = 0; invested = 0; avgCost = 0;
      inPosition = false; fired.clear();
      peak = c.high;
      cycles++;
      cycleDaysTotal += i - cycleStartIdx;
    }

    // --- Entry tiers (deepest-first so a gap-down fills multiple tiers correctly) ---
    for (let t = 0; t < cfg.tiers.length; t++) {
      if (fired.has(t)) continue;
      if (cfg.regimeStop && !regimeUp) continue; // only buy dips while trend is up
      const tier = cfg.tiers[t]!;
      const level = peak * (1 - tier.dd / 100);
      if (c.low <= level) {
        if (!inPosition) { cycleCash = cash; cycleStartIdx = i; inPosition = true; }
        const spend = Math.min(tier.alloc * cycleCash, cash);
        if (spend > 0) {
          const qty = (spend * (1 - FEE)) / level;
          const newBtc = btc + qty;
          invested += spend;
          avgCost = invested / newBtc; // cost basis incl. fees baked into invested $
          btc = newBtc;
          cash -= spend;
          fired.add(t);
        }
      }
    }

    // --- Take profit: sell everything at avgCost*(1+tp) ---
    if (inPosition && btc > 0) {
      const tpLevel = avgCost * (1 + cfg.tp / 100);
      if (c.high >= tpLevel) {
        cash += btc * tpLevel * (1 - FEE);
        btc = 0; invested = 0; avgCost = 0;
        inPosition = false;
        fired.clear();
        peak = c.high; // restart dip-watch from the bounce
        cycles++;
        cycleDaysTotal += i - cycleStartIdx;
      }
    }

    // equity drawdown tracking
    const eq = equityAt(c.close);
    equityPeak = Math.max(equityPeak, eq);
    maxEquityDD = Math.max(maxEquityDD, (equityPeak - eq) / equityPeak);
  }

  const last = candles[candles.length - 1]!;
  const finalEquity = equityAt(last.close);
  return {
    name: cfg.name,
    finalEquity,
    retPct: (finalEquity / CAPITAL - 1) * 100,
    cycles,
    avgCycleDays: cycles ? cycleDaysTotal / cycles : 0,
    timeInMarketPct: (daysInMarket / candles.length) * 100,
    maxEquityDD: maxEquityDD * 100,
    endHolding: inPosition,
  };
}

function buyHold(candles: Candle[]): Result {
  const entry = candles[0]!.close;
  const qty = (CAPITAL * (1 - FEE)) / entry;
  let equityPeak = CAPITAL, maxDD = 0;
  for (const c of candles) {
    const eq = qty * c.close;
    equityPeak = Math.max(equityPeak, eq);
    maxDD = Math.max(maxDD, (equityPeak - eq) / equityPeak);
  }
  const finalEquity = qty * candles[candles.length - 1]!.close;
  return { name: 'Buy & Hold', finalEquity, retPct: (finalEquity / CAPITAL - 1) * 100, cycles: 0, avgCycleDays: 0, timeInMarketPct: 100, maxEquityDD: maxDD * 100, endHolding: true };
}

// Weekly periodic DCA: invest a fixed slice every 7 days, never sell.
function weeklyDca(candles: Candle[]): Result {
  const weeks = Math.floor(candles.length / 7) + 1;
  const perBuy = CAPITAL / weeks;
  let cash = CAPITAL, btc = 0;
  let equityPeak = CAPITAL, maxDD = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    if (i % 7 === 0 && cash > 0) {
      const spend = Math.min(perBuy, cash);
      btc += (spend * (1 - FEE)) / c.close;
      cash -= spend;
    }
    const eq = cash + btc * c.close;
    equityPeak = Math.max(equityPeak, eq);
    maxDD = Math.max(maxDD, (equityPeak - eq) / equityPeak);
  }
  const finalEquity = cash + btc * candles[candles.length - 1]!.close;
  return { name: 'Weekly DCA (hold)', finalEquity, retPct: (finalEquity / CAPITAL - 1) * 100, cycles: 0, avgCycleDays: 0, timeInMarketPct: 100, maxEquityDD: maxDD * 100, endHolding: true };
}

function printRow(r: Result) {
  console.log(
    `${r.name.padEnd(26)} ${fmtUsd(r.finalEquity).padStart(12)}  ${(r.retPct >= 0 ? '+' : '') + r.retPct.toFixed(0) + '%'}`.padEnd(50) +
    `  cycles=${String(r.cycles).padStart(3)}  avgDays=${r.avgCycleDays.toFixed(0).padStart(3)}  inMkt=${r.timeInMarketPct.toFixed(0)}%  maxDD=${r.maxEquityDD.toFixed(0)}%${r.endHolding ? '  [holding@end]' : ''}`,
  );
}

async function main() {
  const symbol = process.argv[2] ?? 'BTCUSDT';
  const start = Date.UTC(2017, 0, 1);
  const end = Date.now();
  console.log(`Fetching ${symbol} 1d candles ...`);
  const candles = await fetchKlines(symbol, '1d', start, end);
  console.log(`Got ${candles.length} candles (${fmtDate(candles[0]!.openTime)} -> ${fmtDate(candles[candles.length - 1]!.openTime)})`);
  console.log(`Capital $${CAPITAL}, fee ${(FEE * 100).toFixed(2)}%/side, fills at exact tier/TP level.\n`);

  const configs: Config[] = [
    { name: 'A shallow (-10/15/20/25, tp+15)', tiers: [{ dd: 10, alloc: 0.25 }, { dd: 15, alloc: 0.25 }, { dd: 20, alloc: 0.25 }, { dd: 25, alloc: 0.25 }], tp: 15 },
    { name: 'B medium (-10/20/30/40, tp+20)', tiers: [{ dd: 10, alloc: 0.2 }, { dd: 20, alloc: 0.25 }, { dd: 30, alloc: 0.25 }, { dd: 40, alloc: 0.3 }], tp: 20 },
    { name: 'C deep (-15/25/35/50, tp+25)', tiers: [{ dd: 15, alloc: 0.2 }, { dd: 25, alloc: 0.25 }, { dd: 35, alloc: 0.25 }, { dd: 50, alloc: 0.3 }], tp: 25 },
    { name: 'D weighted-deep (-10/20/35/55, tp+30)', tiers: [{ dd: 10, alloc: 0.15 }, { dd: 20, alloc: 0.2 }, { dd: 35, alloc: 0.3 }, { dd: 55, alloc: 0.35 }], tp: 30 },
    { name: 'E quick-scalp (-8/14/20, tp+12)', tiers: [{ dd: 8, alloc: 0.34 }, { dd: 14, alloc: 0.33 }, { dd: 20, alloc: 0.33 }], tp: 12 },
  ];

  console.log('=== Benchmarks ===');
  printRow(buyHold(candles));
  printRow(weeklyDca(candles));

  console.log('\n=== DCA dip-bounce strategies (no filter) ===');
  for (const cfg of configs) printRow(runDcaDip(candles, cfg));

  console.log('\n=== Same strategies + 200-DMA regime filter (buy dips only in uptrend, cut below 200DMA) ===');
  for (const cfg of configs) printRow(runDcaDip(candles, { ...cfg, name: cfg.name + ' [200DMA]', regimeStop: true }));
}

main().catch((e) => { console.error(e); process.exit(1); });
