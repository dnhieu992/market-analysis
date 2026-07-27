/**
 * ETH SPOT — deploying ONE pool of capital through an EMA34 dip ladder.
 *
 * The decision this answers: "I have $X to put into ETH. How should I split it across
 * depth tiers below EMA34?" This is a one-shot plan, not a recurring budget:
 *   - tier i = weight_i% of the INITIAL pool, resting at EMA34*(1 - depth_i/100)
 *   - each tier fills at most ONCE over the whole horizon (first touch)
 *   - nothing is ever sold; leftover cash stays cash
 *
 * Robustness: instead of one lucky start date, we roll the start across the entire
 * history (every `stepBars`) and report the DISTRIBUTION of outcomes vs benchmarks.
 *
 * No lookahead: a tier only fills on a bar strictly after the start bar (an intra-candle
 * touch of the level fills at the level). The EMA34 level is recomputed every bar, i.e.
 * you re-place the resting orders each bar — which is how you'd actually run it.
 *
 * Benchmarks per start date:
 *   - LUMP: buy everything at the start bar's close.
 *   - TIME DCA: split the pool into `tiers` equal parts, buy one every
 *     horizon/tiers bars regardless of price.
 *
 * Metric: value at the end of the horizon = units * closeEnd + leftover cash, expressed
 * as a RATIO vs LUMP. >1 means the ladder beat buying it all immediately. We report the
 * mean/median ratio, the win rate, and the 10th percentile (the bad-case tail).
 *
 * Usage:
 *   ts-node --project apps/api/tsconfig.json scripts/run-ema34-ladder-deploy-backtest.ts \
 *     [symbol] [interval] [days] [horizonBars] [stepBars] [feePctPerSide] [emaPeriod]
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;

type Candle = { open: number; high: number; low: number; close: number; openTime: Date };

function fetchJson(url: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
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
        open: parseFloat(k[1] as string),
        high: parseFloat(k[2] as string),
        low: parseFloat(k[3] as string),
        close: parseFloat(k[4] as string),
        openTime: new Date(k[0] as number),
      });
    }
    if (batch.length < MAX_PER_REQ) break;
    cursor = (batch[batch.length - 1]![0] as number) + 1;
  }
  return candles;
}

function ema(values: number[], period: number): number[] {
  const out = new Array(values.length).fill(NaN);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i]!;
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function fmt(n: number, d = 2): string {
  if (!isFinite(n)) return '  -  ';
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

type Ladder = { name: string; tiers: { depth: number; weight: number }[] };

/** Deploy one pool from bar `s` over `horizon` bars. Returns end value and deployed share. */
function deployLadder(
  candles: Candle[],
  e: number[],
  s: number,
  horizon: number,
  ladder: Ladder,
  fee: number,
): { value: number; deployed: number; fillsAt: number[]; maxDD: number } {
  const end = Math.min(s + horizon, candles.length - 1);
  const nT = ladder.tiers.length;
  const filled = new Array(nT).fill(false);
  const fillsAt = new Array(nT).fill(-1);
  let cash = 1;
  let units = 0;
  let peak = 1, maxDD = 0;

  for (let i = s + 1; i <= end; i++) {
    const em = e[i]!;
    const c = candles[i]!;
    if (!isFinite(em) || em <= 0) continue;
    for (let t = 0; t < nT; t++) {
      if (filled[t]) continue;
      const level = em * (1 - ladder.tiers[t]!.depth / 100);
      if (c.low <= level) {
        filled[t] = true;
        fillsAt[t] = i - s;
        const w = ladder.tiers[t]!.weight / 100;
        const spend = Math.min(w, cash);
        cash -= spend;
        units += (spend * (1 - fee)) / level;
      }
    }
    // Mark to market on the close: cash + position. Captures the pain of holding.
    const mtm = cash + units * c.close;
    if (mtm > peak) peak = mtm;
    const dd = (peak - mtm) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return { value: units * candles[end]!.close + cash, deployed: 1 - cash, fillsAt, maxDD: maxDD * 100 };
}

/** Lump sum, with the same mark-to-market drawdown measurement. */
function lumpWithDD(candles: Candle[], s: number, horizon: number, fee: number): { value: number; maxDD: number } {
  const end = Math.min(s + horizon, candles.length - 1);
  const units = (1 * (1 - fee)) / candles[s]!.close;
  let peak = 1, maxDD = 0;
  for (let i = s + 1; i <= end; i++) {
    const mtm = units * candles[i]!.close;
    if (mtm > peak) peak = mtm;
    const dd = (peak - mtm) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return { value: units * candles[end]!.close, maxDD: maxDD * 100 };
}

function deployLump(candles: Candle[], s: number, horizon: number, fee: number): number {
  const end = Math.min(s + horizon, candles.length - 1);
  const units = (1 * (1 - fee)) / candles[s]!.close;
  return units * candles[end]!.close;
}

function deployTimeDca(candles: Candle[], s: number, horizon: number, parts: number, fee: number): number {
  const end = Math.min(s + horizon, candles.length - 1);
  const step = Math.max(1, Math.floor(horizon / parts));
  let units = 0, cash = 1;
  for (let p = 0; p < parts; p++) {
    const i = Math.min(s + p * step, end);
    const spend = Math.min(1 / parts, cash);
    cash -= spend;
    units += (spend * (1 - fee)) / candles[i]!.close;
  }
  return units * candles[end]!.close + cash;
}

async function main() {
  const [, , symArg, intArg, daysArg, horArg, stepArg, feeArg, emaArg] = process.argv;
  const symbol = (symArg ?? 'ETHUSDT').toUpperCase();
  const interval = intArg ?? '1d';
  const days = Number(daysArg ?? 2900);
  const horizon = Number(horArg ?? 180);
  const stepBars = Number(stepArg ?? 5);
  const fee = Number(feeArg ?? 0.05) / 100;
  const emaPeriod = Number(emaArg ?? 34);

  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;
  const candles = await fetchKlines(symbol, interval, startMs, endMs);
  const closes = candles.map((c) => c.close);
  const e = ema(closes, emaPeriod);
  const span = `${candles[0]!.openTime.toISOString().slice(0, 10)} → ${candles[candles.length - 1]!.openTime.toISOString().slice(0, 10)}`;

  const ladders: Ladder[] =
    interval === '1d'
      ? [
          { name: 'single -3%', tiers: [{ depth: 3, weight: 100 }] },
          { name: 'single -6%', tiers: [{ depth: 6, weight: 100 }] },
          { name: 'single -10%', tiers: [{ depth: 10, weight: 100 }] },
          { name: 'flat 3 (3/7/12)', tiers: [{ depth: 3, weight: 33.34 }, { depth: 7, weight: 33.33 }, { depth: 12, weight: 33.33 }] },
          { name: 'flat 4 (3/6/10/16)', tiers: [{ depth: 3, weight: 25 }, { depth: 6, weight: 25 }, { depth: 10, weight: 25 }, { depth: 16, weight: 25 }] },
          { name: 'front 4 (40/30/20/10)', tiers: [{ depth: 3, weight: 40 }, { depth: 6, weight: 30 }, { depth: 10, weight: 20 }, { depth: 16, weight: 10 }] },
          { name: 'front 4 (50/25/15/10)', tiers: [{ depth: 2, weight: 50 }, { depth: 5, weight: 25 }, { depth: 9, weight: 15 }, { depth: 15, weight: 10 }] },
          { name: 'back 4 (10/20/30/40)', tiers: [{ depth: 3, weight: 10 }, { depth: 6, weight: 20 }, { depth: 10, weight: 30 }, { depth: 16, weight: 40 }] },
          { name: 'back 5 (10/15/20/25/30)', tiers: [{ depth: 3, weight: 10 }, { depth: 6, weight: 15 }, { depth: 10, weight: 20 }, { depth: 15, weight: 25 }, { depth: 22, weight: 30 }] },
          { name: 'shallow 3 (1/3/5)', tiers: [{ depth: 1, weight: 40 }, { depth: 3, weight: 35 }, { depth: 5, weight: 25 }] },
          { name: 'fill-weighted 4', tiers: [{ depth: 2, weight: 35 }, { depth: 5, weight: 30 }, { depth: 9, weight: 22 }, { depth: 15, weight: 13 }] },
          { name: 'half-now + 3 tiers', tiers: [{ depth: 0, weight: 50 }, { depth: 5, weight: 20 }, { depth: 10, weight: 17 }, { depth: 16, weight: 13 }] },
        ]
      : [
          { name: 'single -1.5%', tiers: [{ depth: 1.5, weight: 100 }] },
          { name: 'single -3%', tiers: [{ depth: 3, weight: 100 }] },
          { name: 'single -5%', tiers: [{ depth: 5, weight: 100 }] },
          { name: 'flat 3 (1.5/3/6)', tiers: [{ depth: 1.5, weight: 33.34 }, { depth: 3, weight: 33.33 }, { depth: 6, weight: 33.33 }] },
          { name: 'flat 4 (1.5/3/5/8)', tiers: [{ depth: 1.5, weight: 25 }, { depth: 3, weight: 25 }, { depth: 5, weight: 25 }, { depth: 8, weight: 25 }] },
          { name: 'front 4 (40/30/20/10)', tiers: [{ depth: 1.5, weight: 40 }, { depth: 3, weight: 30 }, { depth: 5, weight: 20 }, { depth: 8, weight: 10 }] },
          { name: 'back 4 (10/20/30/40)', tiers: [{ depth: 1.5, weight: 10 }, { depth: 3, weight: 20 }, { depth: 5, weight: 30 }, { depth: 8, weight: 40 }] },
          { name: 'shallow 3 (0.5/1.5/3)', tiers: [{ depth: 0.5, weight: 40 }, { depth: 1.5, weight: 35 }, { depth: 3, weight: 25 }] },
          { name: 'fill-weighted 4', tiers: [{ depth: 1, weight: 35 }, { depth: 2.5, weight: 30 }, { depth: 4.5, weight: 22 }, { depth: 8, weight: 13 }] },
          { name: 'half-now + 3 tiers', tiers: [{ depth: 0, weight: 50 }, { depth: 2.5, weight: 20 }, { depth: 4.5, weight: 17 }, { depth: 8, weight: 13 }] },
        ];

  const starts: number[] = [];
  for (let s = emaPeriod + 1; s + horizon < candles.length; s += stepBars) starts.push(s);

  console.log(`\n===== ${symbol} ${interval} | EMA${emaPeriod} | ${candles.length} candles (${span}) =====`);
  console.log(`one-shot pool deployment | horizon ${horizon} bars | ${starts.length} rolling start dates | fee ${fee * 100}%/side`);
  console.log('\nratio = end value / end value of LUMP (buy it all now). >1 = ladder won.\n');
  console.log('ladder                  | mean  | med   | p10   | p90   | win%  | ret%  | retMed% | maxDD% | ddP90% | avgDep% | fullDep%');

  const lumps = starts.map((s) => lumpWithDD(candles, s, horizon, fee));
  const lumpVals = lumps.map((l) => l.value);
  const line = (
    name: string,
    vals: number[],
    dds: number[],
    avgDeploy: number,
    fullDeploy: number,
  ) => {
    const ratios = vals.map((v, i) => v / lumpVals[i]!).sort((a, b) => a - b);
    const rets = vals.map((v) => (v - 1) * 100).sort((a, b) => a - b);
    const d = [...dds].sort((a, b) => a - b);
    console.log(
      `${name.padEnd(23)} | ${fmt(ratios.reduce((a, b) => a + b, 0) / ratios.length, 3).padStart(5)} | ${fmt(quantile(ratios, 0.5), 3).padStart(5)} | ${fmt(quantile(ratios, 0.1), 3).padStart(5)} | ${fmt(quantile(ratios, 0.9), 3).padStart(5)} | ${fmt((ratios.filter((r) => r > 1).length / ratios.length) * 100, 1).padStart(5)} | ${fmt(rets.reduce((a, b) => a + b, 0) / rets.length, 1).padStart(5)} | ${fmt(quantile(rets, 0.5), 1).padStart(7)} | ${fmt(d.reduce((a, b) => a + b, 0) / d.length, 1).padStart(6)} | ${fmt(quantile(d, 0.9), 1).padStart(6)} | ${fmt(avgDeploy, 1).padStart(7)} | ${fmt(fullDeploy, 1).padStart(8)}`,
    );
  };

  line('LUMP (buy now)', lumpVals, lumps.map((l) => l.maxDD), 100, 100);
  const timeVals = starts.map((s) => deployTimeDca(candles, s, horizon, 4, fee));
  line('TIME DCA (4 parts)', timeVals, lumps.map(() => NaN), 100, 100);

  for (const L of ladders) {
    const res = starts.map((s) => deployLadder(candles, e, s, horizon, L, fee));
    line(
      L.name,
      res.map((r) => r.value),
      res.map((r) => r.maxDD),
      (res.reduce((a, r) => a + r.deployed, 0) / res.length) * 100,
      (res.filter((r) => r.deployed > 0.999).length / res.length) * 100,
    );
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
