/**
 * Backtest the BTC DCA Ladder strategy exactly as the live worker/API implement it.
 *
 * Strategy (no stop-loss, tier-based dip buying):
 *   - A running PEAK is tracked while the cycle is FLAT (raised to each new daily high).
 *   - N buy-limit tiers are armed at firstTierPct, +stepPct, +2*stepPct ... below the peak
 *     (defaults: 10/15/20/25/30% below). Each tier deploys budget/numTiers USD.
 *   - When a daily LOW touches a tier price -> that tier fills at the tier price.
 *   - After the FIRST fill the cycle is IN_POSITION, peak freezes, and a TP sell is armed at
 *     avgCost*(1+tpPct/100). Lower tiers keep filling on deeper dips (avgCost blends down).
 *   - When a daily HIGH reaches the TP price -> sell 100% at TP. realizedPnl is booked and a new
 *     cycle starts with peak=sellPrice and a budget compounded by all realized PnL.
 *   - Buy fee baked into avgCost; sell fee deducted from proceeds (feePct per side).
 *
 * Faithful to packages/core/src/analysis/dca-ladder.ts and the worker syncDaily():
 *   - peak only raised while FLAT; tier prices chase the peak only while FLAT.
 *   - tier-touch fill loop runs regardless of status (deeper tiers fill while IN_POSITION).
 *   - TP check uses the status/tpPrice as of candle OPEN (no same-day enter+exit).
 *
 * Usage:
 *   ts-node --project apps/api/tsconfig.json scripts/run-dca-ladder-backtest.ts \
 *     [days] [startCapital] [firstTierPct] [numTiers] [stepPct] [tpPct] [feePct]
 *   e.g. full history:  ... 3200
 *        defaults:      ... 3200 1000 10 5 5 10 0.05
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const SYMBOL = 'BTCUSDT';
const SEED_DAYS = 30; // ensureCycle seeds peak from 30-day max daily high
const DAY = 24 * 60 * 60 * 1000;

type Candle = { high: number; low: number; close: number; openTime: Date };

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

async function fetchKlines(startMs: number, endMs: number): Promise<Candle[]> {
  const candles: Candle[] = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const url = `${BINANCE_HOST}?symbol=${SYMBOL}&interval=1d&startTime=${cursor}&endTime=${endMs}&limit=${MAX_PER_REQ}`;
    const batch = (await fetchJson(url)) as unknown[][];
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const k of batch) {
      candles.push({
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

function fmt(n: number, d = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

type Params = {
  startCapital: number;
  firstTierPct: number;
  numTiers: number;
  stepPct: number;
  tpPct: number;
  feePct: number;
};

type ClosedCycle = {
  entryTime: Date;
  exitTime: Date;
  fills: number;
  avgCost: number;
  sellPrice: number;
  capitalDeployed: number;
  realizedPnl: number;
  durationDays: number;
  maxUnderwaterPct: number; // worst (avgCost-low)/avgCost during the cycle
};

function tierPctBelow(p: Params): number[] {
  return Array.from({ length: p.numTiers }, (_, i) => p.firstTierPct + i * p.stepPct);
}

function run(candles: Candle[], seedPeak: number, p: Params) {
  const feeMul = 1 - p.feePct / 100;
  const closed: ClosedCycle[] = [];
  let realizedTotal = 0;

  // ── cycle state ──
  let peak = seedPeak;
  let status: 'FLAT' | 'IN_POSITION' = 'FLAT';
  let tierFilled: boolean[] = new Array(p.numTiers).fill(false);
  let positionSize = 0;
  let capitalDeployed = 0;
  let avgCost = 0;
  let tpPrice: number | null = null;
  let entryTime: Date | null = null;
  let fillsCount = 0;
  let maxUnderwaterPct = 0;
  let budget = p.startCapital + realizedTotal;

  const startNewCycle = (newPeak: number) => {
    peak = newPeak;
    status = 'FLAT';
    tierFilled = new Array(p.numTiers).fill(false);
    positionSize = 0;
    capitalDeployed = 0;
    avgCost = 0;
    tpPrice = null;
    entryTime = null;
    fillsCount = 0;
    maxUnderwaterPct = 0;
    budget = p.startCapital + realizedTotal; // compounded
  };

  const pcts = tierPctBelow(p);

  for (const c of candles) {
    const statusOpen = status;
    const tpOpen = tpPrice;

    // 1. FLAT: raise peak to new high (tier prices chase the peak).
    if (status === 'FLAT') peak = Math.max(peak, c.high);

    // current tier prices (frozen once IN_POSITION because peak is frozen)
    const tierPrice = pcts.map((pct) => peak * (1 - pct / 100));
    const usdPerTier = budget / p.numTiers;

    // 2. Tier touches -> fill at tier price (runs regardless of status).
    for (let i = 0; i < p.numTiers; i++) {
      if (!tierFilled[i] && c.low <= tierPrice[i]!) {
        tierFilled[i] = true;
        positionSize += (usdPerTier / tierPrice[i]!) * feeMul;
        capitalDeployed += usdPerTier;
        avgCost = capitalDeployed / positionSize;
        if (status === 'FLAT') {
          status = 'IN_POSITION';
          entryTime = c.openTime;
        }
        fillsCount++;
        tpPrice = avgCost * (1 + p.tpPct / 100);
      }
    }

    // track worst drawdown vs avgCost while holding
    if (status === 'IN_POSITION' && avgCost > 0) {
      const uw = (avgCost - c.low) / avgCost;
      if (uw > maxUnderwaterPct) maxUnderwaterPct = uw;
    }

    // 3. TP check uses status/tpPrice as of candle OPEN (no same-day enter+exit).
    if (statusOpen === 'IN_POSITION' && tpOpen != null && c.high >= tpOpen) {
      const sellPrice = tpOpen;
      const proceeds = positionSize * sellPrice * feeMul;
      const pnl = proceeds - capitalDeployed;
      realizedTotal += pnl;
      closed.push({
        entryTime: entryTime!,
        exitTime: c.openTime,
        fills: fillsCount,
        avgCost,
        sellPrice,
        capitalDeployed,
        realizedPnl: pnl,
        durationDays: Math.round((c.openTime.getTime() - entryTime!.getTime()) / DAY),
        maxUnderwaterPct: maxUnderwaterPct * 100,
      });
      startNewCycle(sellPrice);
    }
  }

  // mark-to-market the final open cycle (capital trapped at end of window)
  const last = candles[candles.length - 1]!;
  let openUnrealized = 0;
  let openInfo: null | { fills: number; avgCost: number; capitalDeployed: number; markPrice: number; underwaterPct: number; daysOpen: number } = null;
  if (status === 'IN_POSITION') {
    const mark = last.close;
    openUnrealized = positionSize * mark * feeMul - capitalDeployed;
    openInfo = {
      fills: fillsCount,
      avgCost,
      capitalDeployed,
      markPrice: mark,
      underwaterPct: ((avgCost - mark) / avgCost) * 100,
      daysOpen: Math.round((last.openTime.getTime() - entryTime!.getTime()) / DAY),
    };
  }

  // time in market vs idle
  // (approx: count days where a position was open)
  let daysInMarket = 0;
  {
    let st: 'FLAT' | 'IN_POSITION' = 'FLAT';
    let pk = seedPeak;
    let filled = new Array(p.numTiers).fill(false);
    let tp: number | null = null;
    let pos = 0, cap = 0, ac = 0;
    let bud = p.startCapital;
    let rt = 0;
    for (const c of candles) {
      const so = st, to = tp;
      if (st === 'FLAT') pk = Math.max(pk, c.high);
      const tpx = pcts.map((pct) => pk * (1 - pct / 100));
      const upt = bud / p.numTiers;
      for (let i = 0; i < p.numTiers; i++) {
        if (!filled[i] && c.low <= tpx[i]!) {
          filled[i] = true; pos += (upt / tpx[i]!) * feeMul; cap += upt; ac = cap / pos;
          if (st === 'FLAT') st = 'IN_POSITION';
          tp = ac * (1 + p.tpPct / 100);
        }
      }
      if (st === 'IN_POSITION') daysInMarket++;
      if (so === 'IN_POSITION' && to != null && c.high >= to) {
        rt += pos * to * feeMul - cap;
        pk = to; st = 'FLAT'; filled = new Array(p.numTiers).fill(false); pos = 0; cap = 0; ac = 0; tp = null; bud = p.startCapital + rt;
      }
    }
  }

  const finalEquity = p.startCapital + realizedTotal + openUnrealized;
  const wins = closed.filter((c) => c.realizedPnl > 0).length;
  const durations = closed.map((c) => c.durationDays);
  const avgDur = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const maxDur = durations.length ? Math.max(...durations) : 0;
  const maxUW = Math.max(0, ...closed.map((c) => c.maxUnderwaterPct), openInfo?.underwaterPct ?? 0);

  return {
    closed,
    cycles: closed.length,
    wins,
    realizedTotal,
    openUnrealized,
    openInfo,
    finalEquity,
    returnPct: (finalEquity / p.startCapital - 1) * 100,
    realizedReturnPct: (realizedTotal / p.startCapital) * 100,
    avgDur,
    maxDur,
    maxUW,
    daysInMarket,
    totalDays: candles.length,
  };
}

async function main() {
  const a = process.argv.slice(2);
  const days = Number(a[0] ?? 3200);
  const p: Params = {
    startCapital: Number(a[1] ?? 1000),
    firstTierPct: Number(a[2] ?? 10),
    numTiers: Number(a[3] ?? 5),
    stepPct: Number(a[4] ?? 5),
    tpPct: Number(a[5] ?? 10),
    feePct: Number(a[6] ?? 0.05),
  };

  const endMs = Date.now();
  const startMs = endMs - days * DAY;
  const seedStartMs = startMs - SEED_DAYS * DAY;
  console.log(`\nFetching ${SYMBOL} 1d (${days}d + ${SEED_DAYS}d seed)...`);
  const all = await fetchKlines(seedStartMs, endMs);
  const seedCandles = all.filter((c) => c.openTime.getTime() < startMs);
  const candles = all.filter((c) => c.openTime.getTime() >= startMs);
  const seedPeak = Math.max(...(seedCandles.length ? seedCandles : candles.slice(0, SEED_DAYS)).map((c) => c.high));
  console.log(`${candles.length} candles  ${candles[0]?.openTime.toISOString().slice(0, 10)} → ${candles[candles.length - 1]?.openTime.toISOString().slice(0, 10)}  | seed peak $${fmt(seedPeak)}`);

  console.log(`\n=== DCA LADDER | ${SYMBOL} 1d | $${p.startCapital} compounding | tiers ${tierPctBelow(p).map((x) => x + '%').join('/')} below peak | TP +${p.tpPct}% | fee ${p.feePct}%/side ===`);
  const r = run(candles, seedPeak, p);

  console.log(`\nCompleted cycles : ${r.cycles}  (wins ${r.wins}/${r.cycles} = ${r.cycles ? fmt((r.wins / r.cycles) * 100) : '0.00'}%)`);
  console.log(`Realized PnL     : $${fmt(r.realizedTotal)}  (+${fmt(r.realizedReturnPct)}% on $${p.startCapital})`);
  console.log(`Open cycle PnL   : $${fmt(r.openUnrealized)} (mark-to-market, unrealized)`);
  console.log(`Final equity     : $${fmt(r.finalEquity)}  (${r.returnPct >= 0 ? '+' : ''}${fmt(r.returnPct)}% total)`);
  console.log(`Cycle duration   : avg ${fmt(r.avgDur, 0)}d  max ${r.maxDur}d`);
  console.log(`Max underwater   : -${fmt(r.maxUW)}%  (worst dip below avgCost in any cycle)`);
  console.log(`Time in market   : ${r.daysInMarket}/${r.totalDays} days (${fmt((r.daysInMarket / r.totalDays) * 100)}%)`);

  if (r.openInfo) {
    const o = r.openInfo;
    console.log(`\n⚠️  Cycle OPEN at window end: ${o.fills} fills, avgCost $${fmt(o.avgCost)}, deployed $${fmt(o.capitalDeployed)}, mark $${fmt(o.markPrice)} → ${o.underwaterPct >= 0 ? 'underwater ' : 'up '}${fmt(Math.abs(o.underwaterPct))}%, open ${o.daysOpen}d (capital trapped, no SL).`);
  }

  // benchmark: buy & hold the same start capital
  const bh = (candles[candles.length - 1]!.close / candles[0]!.close) * p.startCapital;
  console.log(`\nBenchmark buy&hold: $${fmt(bh)}  (${((bh / p.startCapital - 1) * 100 >= 0 ? '+' : '')}${fmt((bh / p.startCapital - 1) * 100)}%) over same window.`);

  console.log(`\nLast ${Math.min(8, r.closed.length)} closed cycles:`);
  console.log('  entry       exit        fills  avgCost     sell        deployed    pnl        maxUW%  days');
  for (const c of r.closed.slice(-8)) {
    console.log(
      `  ${c.entryTime.toISOString().slice(0, 10)}  ${c.exitTime.toISOString().slice(0, 10)}  ${String(c.fills).padStart(5)}  ${fmt(c.avgCost).padStart(9)}  ${fmt(c.sellPrice).padStart(9)}  ${('$' + fmt(c.capitalDeployed)).padStart(10)}  ${((c.realizedPnl >= 0 ? '+$' : '-$') + fmt(Math.abs(c.realizedPnl))).padStart(9)}  ${fmt(c.maxUnderwaterPct).padStart(5)}  ${String(c.durationDays).padStart(4)}`
    );
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
