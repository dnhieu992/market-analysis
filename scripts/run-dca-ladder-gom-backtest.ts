/**
 * A/B backtest: does gating the DCA ladder's cycle-START on the /tracking-coins
 * GOM zone improve entries vs. the always-armed baseline ladder?
 *
 * Baseline  = scripts/run-dca-ladder-backtest.ts: while FLAT the peak chases new
 *             highs and N tiers (10/15/20/25/30% below peak) are always armed;
 *             a daily low touching a tier fills it; TP at avgCost*(1+tpPct).
 *
 * GOM-gated = identical mechanics, EXCEPT a cycle does not arm/fill any tier
 *             while FLAT until the BTC D1 DCA signal enters the **GOM** zone
 *             (dcaZone: below EMA34 AND RSI(14)<=35 AND within 8% of the 20-day
 *             low). The peak keeps chasing highs while waiting; on the GOM bar
 *             the peak freezes and the standard tiers arm. After a TP close the
 *             cycle returns to FLAT-and-waiting-for-GOM.
 *
 * Reuses the SHIPPED logic: `calculateEma`, `calculateRsi`, `dcaZone` from @app/core
 * (the exact functions computeDcaTimingSignal calls). Same window/params for both
 * arms so the only difference is the entry gate.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-dca-ladder-gom-backtest.ts [days] [startCapital] [firstTierPct] [numTiers] [stepPct] [tpPct] [feePct]
 *   defaults: 3200 1000 10 5 5 10 0.05
 */
import * as https from 'https';
import { calculateEma, calculateRsi, dcaZone } from '@app/core';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const SYMBOL = 'BTCUSDT';
const WARMUP_DAYS = 220; // indicator warmup (EMA34/RSI14/20d-low) before the window
const DAY = 24 * 60 * 60 * 1000;

type Candle = { high: number; low: number; close: number; openTime: Date };

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

type Params = { startCapital: number; firstTierPct: number; numTiers: number; stepPct: number; tpPct: number; feePct: number };
type ClosedCycle = { entryTime: Date; exitTime: Date; fills: number; avgCost: number; sellPrice: number; capitalDeployed: number; realizedPnl: number; durationDays: number; maxUnderwaterPct: number };

function tierPctBelow(p: Params): number[] {
  return Array.from({ length: p.numTiers }, (_, i) => p.firstTierPct + i * p.stepPct);
}

/** The shipped D1 DCA zone at global index gi over full-history arrays. */
function zoneAt(closes: number[], highs: number[], lows: number[], gi: number): 'GOM' | 'CHO' | 'CHOT' {
  const sub = closes.slice(0, gi + 1);
  const close = closes[gi]!;
  const ema34Above = sub.length >= 34 ? close > calculateEma(sub, 34) : false;
  const rsi = sub.length > 14 ? calculateRsi(sub, 14) : 50;
  const lo = lows.slice(Math.max(0, gi - 19), gi + 1);
  const low20 = Math.min(...lo);
  const low20Pct = low20 > 0 ? Number((((close - low20) / low20) * 100).toFixed(1)) : null;
  return dcaZone({ ema34Above, rsi, low20Pct });
}

/**
 * @param gated when true, a cycle only arms tiers once the GOM zone fires while FLAT.
 */
function run(all: Candle[], startIdx: number, seedPeak: number, p: Params, gated: boolean) {
  const closes = all.map((c) => c.close);
  const highs = all.map((c) => c.high);
  const lows = all.map((c) => c.low);
  const feeMul = 1 - p.feePct / 100;
  const pcts = tierPctBelow(p);

  const closed: ClosedCycle[] = [];
  let realizedTotal = 0;

  let peak = seedPeak;
  let status: 'FLAT' | 'IN_POSITION' = 'FLAT';
  let armed = !gated; // baseline is always armed; gated waits for GOM
  let tierFilled: boolean[] = new Array(p.numTiers).fill(false);
  let positionSize = 0, capitalDeployed = 0, avgCost = 0;
  let tpPrice: number | null = null;
  let entryTime: Date | null = null;
  let fillsCount = 0, maxUnderwaterPct = 0;
  let budget = p.startCapital + realizedTotal;
  let daysInMarket = 0, daysWaitingGom = 0;

  const startNewCycle = (newPeak: number) => {
    peak = newPeak; status = 'FLAT'; armed = !gated;
    tierFilled = new Array(p.numTiers).fill(false);
    positionSize = 0; capitalDeployed = 0; avgCost = 0; tpPrice = null; entryTime = null;
    fillsCount = 0; maxUnderwaterPct = 0; budget = p.startCapital + realizedTotal;
  };

  for (let gi = startIdx; gi < all.length; gi++) {
    const c = all[gi]!;
    const statusOpen = status;
    const tpOpen = tpPrice;

    if (status === 'FLAT') peak = Math.max(peak, c.high);

    // GOM gate: arm the cycle when the zone first fires (evaluated on the closed bar).
    if (gated && status === 'FLAT' && !armed) {
      if (zoneAt(closes, highs, lows, gi) === 'GOM') armed = true;
      else { daysWaitingGom++; continue; } // idle: no tiers active yet this bar
    }

    const tierPrice = pcts.map((pct) => peak * (1 - pct / 100));
    const usdPerTier = budget / p.numTiers;

    for (let i = 0; i < p.numTiers; i++) {
      if (!tierFilled[i] && c.low <= tierPrice[i]!) {
        tierFilled[i] = true;
        positionSize += (usdPerTier / tierPrice[i]!) * feeMul;
        capitalDeployed += usdPerTier;
        avgCost = capitalDeployed / positionSize;
        if (status === 'FLAT') { status = 'IN_POSITION'; entryTime = c.openTime; }
        fillsCount++;
        tpPrice = avgCost * (1 + p.tpPct / 100);
      }
    }

    if (status === 'IN_POSITION') {
      daysInMarket++;
      if (avgCost > 0) {
        const uw = (avgCost - c.low) / avgCost;
        if (uw > maxUnderwaterPct) maxUnderwaterPct = uw;
      }
    }

    if (statusOpen === 'IN_POSITION' && tpOpen != null && c.high >= tpOpen) {
      const sellPrice = tpOpen;
      const pnl = positionSize * sellPrice * feeMul - capitalDeployed;
      realizedTotal += pnl;
      closed.push({
        entryTime: entryTime!, exitTime: c.openTime, fills: fillsCount, avgCost, sellPrice,
        capitalDeployed, realizedPnl: pnl,
        durationDays: Math.round((c.openTime.getTime() - entryTime!.getTime()) / DAY),
        maxUnderwaterPct: maxUnderwaterPct * 100,
      });
      startNewCycle(sellPrice);
    }
  }

  const last = all[all.length - 1]!;
  let openUnrealized = 0;
  let openInfo: null | { fills: number; avgCost: number; capitalDeployed: number; markPrice: number; underwaterPct: number; daysOpen: number } = null;
  if (status === 'IN_POSITION') {
    const mark = last.close;
    openUnrealized = positionSize * mark * feeMul - capitalDeployed;
    openInfo = { fills: fillsCount, avgCost, capitalDeployed, markPrice: mark, underwaterPct: ((avgCost - mark) / avgCost) * 100, daysOpen: Math.round((last.openTime.getTime() - entryTime!.getTime()) / DAY) };
  }

  const finalEquity = p.startCapital + realizedTotal + openUnrealized;
  const wins = closed.filter((c) => c.realizedPnl > 0).length;
  const durations = closed.map((c) => c.durationDays);
  const avgDur = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const maxDur = durations.length ? Math.max(...durations) : 0;
  const maxUW = Math.max(0, ...closed.map((c) => c.maxUnderwaterPct), openInfo?.underwaterPct ?? 0);
  const totalDays = all.length - startIdx;

  return { closed, cycles: closed.length, wins, realizedTotal, openUnrealized, openInfo, finalEquity, returnPct: (finalEquity / p.startCapital - 1) * 100, avgDur, maxDur, maxUW, daysInMarket, daysWaitingGom, totalDays };
}

function report(label: string, r: ReturnType<typeof run>, p: Params) {
  console.log(`\n=== ${label} ===`);
  console.log(`Completed cycles : ${r.cycles}  (wins ${r.wins}/${r.cycles} = ${r.cycles ? fmt((r.wins / r.cycles) * 100) : '0.00'}%)`);
  console.log(`Realized PnL     : $${fmt(r.realizedTotal)}  (${(r.realizedTotal >= 0 ? '+' : '')}${fmt((r.realizedTotal / p.startCapital) * 100)}% on $${p.startCapital})`);
  console.log(`Open cycle PnL   : $${fmt(r.openUnrealized)} (mark-to-market)`);
  console.log(`Final equity     : $${fmt(r.finalEquity)}  (${r.returnPct >= 0 ? '+' : ''}${fmt(r.returnPct)}% total)`);
  console.log(`Cycle duration   : avg ${fmt(r.avgDur, 0)}d  max ${r.maxDur}d`);
  console.log(`Max underwater   : -${fmt(r.maxUW)}%`);
  console.log(`Time in market   : ${r.daysInMarket}/${r.totalDays} days (${fmt((r.daysInMarket / r.totalDays) * 100)}%)`);
  if (r.daysWaitingGom) console.log(`Days waiting GOM : ${r.daysWaitingGom} (idle, no tier armed)`);
  if (r.openInfo) {
    const o = r.openInfo;
    console.log(`⚠️  Cycle OPEN at end: ${o.fills} fills, avgCost $${fmt(o.avgCost)}, deployed $${fmt(o.capitalDeployed)}, mark $${fmt(o.markPrice)} → ${o.underwaterPct >= 0 ? 'underwater ' : 'up '}${fmt(Math.abs(o.underwaterPct))}%, open ${o.daysOpen}d.`);
  }
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
  const warmStartMs = startMs - WARMUP_DAYS * DAY;
  console.log(`\nFetching ${SYMBOL} 1d (${days}d + ${WARMUP_DAYS}d warmup)...`);
  const all = await fetchKlines(warmStartMs, endMs);
  let startIdx = all.findIndex((c) => c.openTime.getTime() >= startMs);
  if (startIdx < 0) startIdx = Math.min(WARMUP_DAYS, all.length - 1);
  const seedPeak = Math.max(...all.slice(Math.max(0, startIdx - 30), startIdx).map((c) => c.high));
  const win = all.slice(startIdx);
  console.log(`${win.length} candles  ${win[0]?.openTime.toISOString().slice(0, 10)} → ${win[win.length - 1]?.openTime.toISOString().slice(0, 10)}  | seed peak $${fmt(seedPeak)}`);
  console.log(`Config: $${p.startCapital} compounding | tiers ${tierPctBelow(p).map((x) => x + '%').join('/')} below peak | TP +${p.tpPct}% | fee ${p.feePct}%/side`);

  const base = run(all, startIdx, seedPeak, p, false);
  const gom = run(all, startIdx, seedPeak, p, true);
  report('BASELINE (always armed)', base, p);
  report('GOM-GATED (start only in GOM zone)', gom, p);

  const bh = (win[win.length - 1]!.close / win[0]!.close) * p.startCapital;
  console.log(`\nBenchmark buy&hold: $${fmt(bh)}  (${((bh / p.startCapital - 1) * 100 >= 0 ? '+' : '')}${fmt((bh / p.startCapital - 1) * 100)}%) over same window.`);

  const dEq = gom.finalEquity - base.finalEquity;
  console.log(`\nΔ (GOM − baseline): equity ${dEq >= 0 ? '+' : ''}$${fmt(dEq)}  | cycles ${gom.cycles - base.cycles}  | maxUW ${(gom.maxUW - base.maxUW) >= 0 ? '+' : ''}${fmt(gom.maxUW - base.maxUW)}%\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
