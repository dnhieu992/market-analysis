/**
 * DCA Ladder with a WEEKLY-TREND-ADAPTIVE first tier.
 *
 *   weekly BULL  (Up / StrongUp)            -> firstTierPct = 5%  (enter shallower)
 *   weekly BEAR/NEUTRAL (Down/StrongDown/Neutral) -> firstTierPct = 10% (enter deeper)
 *
 * Everything else matches the LIVE ladder (numTiers 10, stepPct 1.5, TP +10%, fee 0.05%/side).
 * The weekly trend is the SAME `computeTimeframeTrend` the app uses for `weekTrend`
 * (EMA89 + swing-pivot structure), evaluated on COMPLETED weekly candles only (no lookahead).
 * While a cycle is FLAT the first-tier % is re-evaluated each day (tiers chase the peak);
 * once IN_POSITION the peak and tiers freeze.
 *
 * Runs three arms on the same window/seed for a clean comparison:
 *   STATIC 5%   |   STATIC 10%   |   ADAPTIVE (5/10 by weekly trend)
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-dca-ladder-wtrend-backtest.ts [days] [startCapital] [numTiers] [stepPct] [tpPct] [feePct]
 *   defaults: 3200 1000 10 1.5 10 0.05
 */
import * as https from 'https';
import { computeTimeframeTrend } from '@app/core';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const SYMBOL = 'BTCUSDT';
const WARMUP_DAYS = 220;
const DAY = 24 * 60 * 60 * 1000;
const BULL_FIRST = 5;   // weekly bull
const BEAR_FIRST = 10;  // weekly bear/neutral

type Candle = { high: number; low: number; close: number; openTime: Date; closeTime: Date };

function fetchJson(url: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function fetchKlines(interval: string, startMs: number, endMs: number): Promise<Candle[]> {
  const candles: Candle[] = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const url = `${BINANCE_HOST}?symbol=${SYMBOL}&interval=${interval}&startTime=${cursor}&endTime=${endMs}&limit=${MAX_PER_REQ}`;
    const batch = (await fetchJson(url)) as unknown[][];
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const k of batch) {
      candles.push({
        high: parseFloat(k[2] as string), low: parseFloat(k[3] as string), close: parseFloat(k[4] as string),
        openTime: new Date(k[0] as number), closeTime: new Date(k[6] as number),
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

type Params = { startCapital: number; numTiers: number; stepPct: number; tpPct: number; feePct: number };
type ClosedCycle = { entryTime: Date; exitTime: Date; fills: number; avgCost: number; sellPrice: number; capitalDeployed: number; realizedPnl: number; durationDays: number; maxUnderwaterPct: number };

function tierPrices(peak: number, firstTierPct: number, p: Params): number[] {
  return Array.from({ length: p.numTiers }, (_, i) => peak * (1 - (firstTierPct + i * p.stepPct) / 100));
}

/** Build a per-daily-index weekly-trend lookup from COMPLETED weekly candles. */
function weeklyTrendForDays(daily: Candle[], weekly: Candle[]): ('bull' | 'bear')[] {
  const out: ('bull' | 'bear')[] = new Array(daily.length).fill('bear');
  let wi = 0; // number of weekly candles already CLOSED
  for (let gi = 0; gi < daily.length; gi++) {
    const d = daily[gi]!.openTime.getTime();
    while (wi < weekly.length && weekly[wi]!.closeTime.getTime() <= d) wi++;
    if (wi < 20) { out[gi] = 'bear'; continue; } // not enough history -> conservative
    const sub = weekly.slice(0, wi);
    const t = computeTimeframeTrend(sub.map((c) => c.close), sub.map((c) => c.high), sub.map((c) => c.low));
    out[gi] = t === 'Up' || t === 'StrongUp' ? 'bull' : 'bear';
  }
  return out;
}

/** mode: 'static5' | 'static10' | 'adaptive' */
function run(all: Candle[], startIdx: number, seedPeak: number, p: Params, mode: string, wtrend: ('bull' | 'bear')[]) {
  const feeMul = 1 - p.feePct / 100;
  const closed: ClosedCycle[] = [];
  let realizedTotal = 0;

  let peak = seedPeak;
  let status: 'FLAT' | 'IN_POSITION' = 'FLAT';
  let tierFilled: boolean[] = new Array(p.numTiers).fill(false);
  let positionSize = 0, capitalDeployed = 0, avgCost = 0;
  let tpPrice: number | null = null;
  let entryTime: Date | null = null;
  let fillsCount = 0, maxUnderwaterPct = 0;
  let budget = p.startCapital + realizedTotal;
  let daysInMarket = 0;
  let bullEntries = 0, bearEntries = 0;

  const firstTierFor = (gi: number): number => {
    if (mode === 'static5') return BULL_FIRST;
    if (mode === 'static10') return BEAR_FIRST;
    return wtrend[gi] === 'bull' ? BULL_FIRST : BEAR_FIRST; // adaptive
  };

  const startNewCycle = (newPeak: number) => {
    peak = newPeak; status = 'FLAT';
    tierFilled = new Array(p.numTiers).fill(false);
    positionSize = 0; capitalDeployed = 0; avgCost = 0; tpPrice = null; entryTime = null;
    fillsCount = 0; maxUnderwaterPct = 0; budget = p.startCapital + realizedTotal;
  };

  for (let gi = startIdx; gi < all.length; gi++) {
    const c = all[gi]!;
    const statusOpen = status;
    const tpOpen = tpPrice;

    if (status === 'FLAT') peak = Math.max(peak, c.high);

    const firstTierPct = firstTierFor(gi);              // frozen implicitly once IN_POSITION (peak frozen)
    const tp = tierPrices(peak, firstTierPct, p);
    const usdPerTier = budget / p.numTiers;

    for (let i = 0; i < p.numTiers; i++) {
      if (!tierFilled[i] && c.low <= tp[i]!) {
        tierFilled[i] = true;
        positionSize += (usdPerTier / tp[i]!) * feeMul;
        capitalDeployed += usdPerTier;
        avgCost = capitalDeployed / positionSize;
        if (status === 'FLAT') {
          status = 'IN_POSITION'; entryTime = c.openTime;
          if (wtrend[gi] === 'bull') bullEntries++; else bearEntries++;
        }
        fillsCount++;
        tpPrice = avgCost * (1 + p.tpPct / 100);
      }
    }

    if (status === 'IN_POSITION') {
      daysInMarket++;
      if (avgCost > 0) { const uw = (avgCost - c.low) / avgCost; if (uw > maxUnderwaterPct) maxUnderwaterPct = uw; }
    }

    if (statusOpen === 'IN_POSITION' && tpOpen != null && c.high >= tpOpen) {
      const sellPrice = tpOpen;
      const pnl = positionSize * sellPrice * feeMul - capitalDeployed;
      realizedTotal += pnl;
      closed.push({ entryTime: entryTime!, exitTime: c.openTime, fills: fillsCount, avgCost, sellPrice, capitalDeployed, realizedPnl: pnl, durationDays: Math.round((c.openTime.getTime() - entryTime!.getTime()) / DAY), maxUnderwaterPct: maxUnderwaterPct * 100 });
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
  const maxUW = Math.max(0, ...closed.map((c) => c.maxUnderwaterPct), openInfo?.underwaterPct ?? 0);
  const totalDays = all.length - startIdx;
  return { cycles: closed.length, wins, realizedTotal, openUnrealized, openInfo, finalEquity, returnPct: (finalEquity / p.startCapital - 1) * 100, maxUW, daysInMarket, totalDays, bullEntries, bearEntries };
}

function report(label: string, r: ReturnType<typeof run>, p: Params) {
  console.log(`\n=== ${label} ===`);
  console.log(`Completed cycles : ${r.cycles}  (wins ${r.wins}/${r.cycles})  | entries bull/bear: ${r.bullEntries}/${r.bearEntries}`);
  console.log(`Realized PnL     : $${fmt(r.realizedTotal)}  (${r.realizedTotal >= 0 ? '+' : ''}${fmt((r.realizedTotal / p.startCapital) * 100)}%)`);
  console.log(`Open cycle PnL   : $${fmt(r.openUnrealized)} (m2m)`);
  console.log(`Final equity     : $${fmt(r.finalEquity)}  (${r.returnPct >= 0 ? '+' : ''}${fmt(r.returnPct)}%)`);
  console.log(`Max underwater   : -${fmt(r.maxUW)}%`);
  console.log(`Time in market   : ${r.daysInMarket}/${r.totalDays} (${fmt((r.daysInMarket / r.totalDays) * 100)}%)`);
  if (r.openInfo) { const o = r.openInfo; console.log(`⚠️  OPEN: ${o.fills} fills, avgCost $${fmt(o.avgCost)}, mark $${fmt(o.markPrice)} → underwater ${fmt(Math.abs(o.underwaterPct))}%, ${o.daysOpen}d`); }
}

async function main() {
  const a = process.argv.slice(2);
  const days = Number(a[0] ?? 3200);
  const p: Params = { startCapital: Number(a[1] ?? 1000), numTiers: Number(a[2] ?? 10), stepPct: Number(a[3] ?? 1.5), tpPct: Number(a[4] ?? 10), feePct: Number(a[5] ?? 0.05) };

  const endMs = Date.now();
  const startMs = endMs - days * DAY;
  const warmStartMs = startMs - WARMUP_DAYS * DAY;
  console.log(`\nFetching ${SYMBOL} 1d + 1w ...`);
  const [daily, weekly] = await Promise.all([
    fetchKlines('1d', warmStartMs, endMs),
    fetchKlines('1w', warmStartMs - 200 * 7 * DAY, endMs), // extra weekly history for EMA89
  ]);
  let startIdx = daily.findIndex((c) => c.openTime.getTime() >= startMs);
  if (startIdx < 0) startIdx = Math.min(WARMUP_DAYS, daily.length - 1);
  const seedPeak = Math.max(...daily.slice(Math.max(0, startIdx - 30), startIdx).map((c) => c.high));
  const win = daily.slice(startIdx);
  const wtrend = weeklyTrendForDays(daily, weekly);
  const bullDays = wtrend.slice(startIdx).filter((x) => x === 'bull').length;

  console.log(`${win.length} candles  ${win[0]?.openTime.toISOString().slice(0, 10)} → ${win[win.length - 1]?.openTime.toISOString().slice(0, 10)}  | seed peak $${fmt(seedPeak)}`);
  console.log(`Weekly regime in window: bull ${bullDays}d / bear ${win.length - bullDays}d  | config: ${p.numTiers} tiers, step ${p.stepPct}%, TP +${p.tpPct}%, fee ${p.feePct}%/side`);
  console.log(`Adaptive rule: bull→first ${BULL_FIRST}% · bear/neutral→first ${BEAR_FIRST}%`);

  report('STATIC 5%', run(daily, startIdx, seedPeak, p, 'static5', wtrend), p);
  report('STATIC 10%', run(daily, startIdx, seedPeak, p, 'static10', wtrend), p);
  report('ADAPTIVE (5 bull / 10 bear)', run(daily, startIdx, seedPeak, p, 'adaptive', wtrend), p);

  const bh = (win[win.length - 1]!.close / win[0]!.close) * p.startCapital;
  console.log(`\nBenchmark buy&hold: $${fmt(bh)}  (${(bh / p.startCapital - 1) * 100 >= 0 ? '+' : ''}${fmt((bh / p.startCapital - 1) * 100)}%)\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
