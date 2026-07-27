/**
 * ETH SPOT DCA ladder below EMA34 — how should capital be spread across depth tiers?
 *
 * Cycle definition (one "episode"):
 *   - A cycle ARMS when a candle closes below EMA34 and no position is open.
 *   - Tier i fills INTRA-CANDLE when low <= EMA34_now * (1 - D_i/100).
 *     Fill price = that level (a resting limit order re-placed each bar against the
 *     current EMA34 — realistic for spot: you recompute the level daily).
 *     Each tier fills at most once per cycle, tiers can fill on the same candle.
 *   - EXIT: full exit of the whole position when a later candle's HIGH >= EMA34
 *     (exit price = EMA34 of that bar). No stop loss — this is spot accumulation.
 *   - Cash not deployed earns nothing. Return is measured on the TOTAL pool, so a
 *     ladder that reserves capital for deep tiers that rarely fill is penalised.
 *
 * Fee: feePctPerSide on every buy tranche and on the exit.
 * Pool is compounded: profit from a cycle grows the pool for the next cycle.
 *
 * Reported per ladder:
 *   cycles, fill rate per tier, % of pool deployed on average, avg entry discount
 *   vs EMA34, avg return per cycle (on pool), final equity, max drawdown (mark-to-
 *   market on closes, so it includes unrealised pain), avg/max bars per cycle.
 *
 * Usage:
 *   ts-node --project apps/api/tsconfig.json scripts/run-ema34-dca-ladder-backtest.ts \
 *     [symbol] [intervals] [days] [capital] [feePctPerSide] [emaPeriod]
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

type CycleResult = {
  start: Date;
  end: Date | null;
  bars: number;
  deployedFrac: number;   // share of pool actually spent
  avgDiscount: number;    // weighted avg entry discount vs EMA34 at fill time (%)
  poolRet: number;        // return on the whole pool for this cycle
  resolved: boolean;
  worstUnreal: number;    // worst mark-to-market loss on the pool during the cycle (%)
};

function runLadder(
  candles: Candle[],
  e: number[],
  emaPeriod: number,
  ladder: Ladder,
  feePerSide: number,
): {
  cycles: CycleResult[];
  fills: number[];
  equityCurve: number[];
} {
  const fee = feePerSide / 100;
  const nT = ladder.tiers.length;
  const fills = new Array(nT).fill(0);
  const cycles: CycleResult[] = [];

  // Position state within a cycle. Amounts are FRACTIONS of the pool at cycle start.
  let open = false;
  let startIdx = -1;
  let spent = 0;         // fraction of pool spent (incl. fee)
  let qty = 0;           // "units" bought, priced in pool-fraction terms
  let discSum = 0;       // weight-weighted discount
  let discW = 0;
  const filled = new Array(nT).fill(false);
  let worstUnreal = 0;

  const equityCurve: number[] = [];
  let pool = 1; // normalised; compounding applied per cycle

  for (let i = emaPeriod; i < candles.length; i++) {
    const c = candles[i]!;
    const em = e[i]!;
    if (!isFinite(em) || em <= 0) continue;

    let armingBar = false;
    if (!open) {
      if (c.close < em) {
        open = true;
        armingBar = true;
        startIdx = i;
        spent = 0;
        qty = 0;
        discSum = 0;
        discW = 0;
        filled.fill(false);
        worstUnreal = 0;
      } else {
        equityCurve.push(pool);
        continue;
      }
    }

    // 1) Fill tiers. NO LOOKAHEAD: on the arming bar the signal is only known at the
    //    close, so a tier can only fill at that CLOSE (and only if the close is already
    //    at/below the level). Deeper tiers rest as limit orders for subsequent bars,
    //    where an intra-candle touch of the level is a legitimate fill.
    for (let t = 0; t < nT; t++) {
      if (filled[t]) continue;
      const level = em * (1 - ladder.tiers[t]!.depth / 100);
      let fillPrice = NaN;
      if (armingBar) {
        if (c.close <= level) fillPrice = c.close;
      } else if (c.low <= level) {
        fillPrice = level;
      }
      if (!isFinite(fillPrice)) continue;
      filled[t] = true;
      fills[t]++;
      const w = ladder.tiers[t]!.weight / 100;
      spent += w;
      qty += (w * (1 - fee)) / fillPrice; // fee reduces units bought
      discSum += w * ((em - fillPrice) / em) * 100;
      discW += w;
    }

    // 2) Exit: high touches EMA34 → sell everything at EMA34.
    //    Skipped on the arming bar: that bar's high happened BEFORE the close that
    //    generated the signal, so exiting on it would be lookahead.
    if (!armingBar && c.high >= em && qty > 0) {
      const proceeds = qty * em * (1 - fee);
      const cash = 1 - spent;
      const cycleRet = cash + proceeds - 1;
      pool *= 1 + cycleRet;
      cycles.push({
        start: candles[startIdx]!.openTime,
        end: c.openTime,
        bars: i - startIdx,
        deployedFrac: spent,
        avgDiscount: discW > 0 ? discSum / discW : 0,
        poolRet: cycleRet,
        resolved: true,
        worstUnreal,
      });
      open = false;
      equityCurve.push(pool);
      continue;
    }

    // No tier filled yet and price is back above EMA → cycle ends flat.
    if (!armingBar && c.high >= em && qty === 0) {
      cycles.push({
        start: candles[startIdx]!.openTime,
        end: c.openTime,
        bars: i - startIdx,
        deployedFrac: 0,
        avgDiscount: 0,
        poolRet: 0,
        resolved: true,
        worstUnreal: 0,
      });
      open = false;
      equityCurve.push(pool);
      continue;
    }

    // 3) Mark to market on the close (for drawdown + worst unrealised).
    const mtm = 1 - spent + qty * c.close;
    if (mtm - 1 < worstUnreal) worstUnreal = mtm - 1;
    equityCurve.push(pool * mtm);
  }

  // Cycle still open at the end of data: mark to market at the last close.
  if (open && startIdx >= 0) {
    const last = candles[candles.length - 1]!;
    const mtm = 1 - spent + qty * last.close;
    pool *= mtm;
    cycles.push({
      start: candles[startIdx]!.openTime,
      end: null,
      bars: candles.length - 1 - startIdx,
      deployedFrac: spent,
      avgDiscount: discW > 0 ? discSum / discW : 0,
      poolRet: mtm - 1,
      resolved: false,
      worstUnreal,
    });
  }

  return { cycles, fills, equityCurve };
}

function maxDrawdown(curve: number[]): number {
  let peak = -Infinity, mdd = 0;
  for (const v of curve) {
    if (v > peak) peak = v;
    const dd = (peak - v) / peak;
    if (dd > mdd) mdd = dd;
  }
  return mdd * 100;
}

/**
 * Per-depth fill statistics, independent of any ladder — the input for choosing weights.
 * For each depth D: in what share of cycles does a resting limit at EMA34*(1-D/100)
 * get filled, how long after the cycle starts, and what does the cycle look like after.
 * Same no-lookahead rule as runLadder.
 */
function depthStats(candles: Candle[], e: number[], emaPeriod: number, depths: number[]) {
  const nD = depths.length;
  const cyclesFilled = new Array(nD).fill(0);
  const barsToFill: number[][] = depths.map(() => []);
  let cycles = 0;

  let open = false;
  let startIdx = -1;
  const filled = new Array(nD).fill(false);

  for (let i = emaPeriod; i < candles.length; i++) {
    const c = candles[i]!;
    const em = e[i]!;
    if (!isFinite(em) || em <= 0) continue;

    let armingBar = false;
    if (!open) {
      if (c.close < em) {
        open = true;
        armingBar = true;
        startIdx = i;
        filled.fill(false);
        cycles++;
      } else continue;
    }

    for (let t = 0; t < nD; t++) {
      if (filled[t]) continue;
      const level = em * (1 - depths[t]! / 100);
      const hit = armingBar ? c.close <= level : c.low <= level;
      if (hit) {
        filled[t] = true;
        cyclesFilled[t]++;
        barsToFill[t]!.push(i - startIdx);
      }
    }

    if (!armingBar && c.high >= em) open = false;
  }

  return { cycles, cyclesFilled, barsToFill };
}

async function main() {
  const [, , symArg, intArg, daysArg, capArg, feeArg, emaArg] = process.argv;
  const symbol = (symArg ?? 'ETHUSDT').toUpperCase();
  const intervals = (intArg ?? '1d,4h').split(',').map((s) => s.trim());
  const days = Number(daysArg ?? 2900);
  const capital = Number(capArg ?? 1000);
  const feePerSide = Number(feeArg ?? 0.05);
  const emaPeriod = Number(emaArg ?? 34);

  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;

  // Ladders per timeframe: D1 depths are ~2.5x H4 depths (from the depth study).
  const laddersByTf: Record<string, Ladder[]> = {
    '1d': [
      { name: 'all-in @ close<EMA', tiers: [{ depth: 0, weight: 100 }] },
      { name: 'flat 3 (3/7/12)', tiers: [{ depth: 3, weight: 33.34 }, { depth: 7, weight: 33.33 }, { depth: 12, weight: 33.33 }] },
      { name: 'flat 4 (3/6/10/16)', tiers: [{ depth: 3, weight: 25 }, { depth: 6, weight: 25 }, { depth: 10, weight: 25 }, { depth: 16, weight: 25 }] },
      { name: 'flat 5 (3/6/10/15/22)', tiers: [{ depth: 3, weight: 20 }, { depth: 6, weight: 20 }, { depth: 10, weight: 20 }, { depth: 15, weight: 20 }, { depth: 22, weight: 20 }] },
      { name: 'front 4 (40/30/20/10)', tiers: [{ depth: 3, weight: 40 }, { depth: 6, weight: 30 }, { depth: 10, weight: 20 }, { depth: 16, weight: 10 }] },
      { name: 'back 4 (10/20/30/40)', tiers: [{ depth: 3, weight: 10 }, { depth: 6, weight: 20 }, { depth: 10, weight: 30 }, { depth: 16, weight: 40 }] },
      { name: 'back 5 (10/15/20/25/30)', tiers: [{ depth: 3, weight: 10 }, { depth: 6, weight: 15 }, { depth: 10, weight: 20 }, { depth: 15, weight: 25 }, { depth: 22, weight: 30 }] },
      { name: 'shallow 3 (2/4/7)', tiers: [{ depth: 2, weight: 33.34 }, { depth: 4, weight: 33.33 }, { depth: 7, weight: 33.33 }] },
      { name: 'deep-only 3 (8/15/25)', tiers: [{ depth: 8, weight: 33.34 }, { depth: 15, weight: 33.33 }, { depth: 25, weight: 33.33 }] },
      { name: 'mild-back 4 (20/25/27/28)', tiers: [{ depth: 3, weight: 20 }, { depth: 6, weight: 25 }, { depth: 10, weight: 27 }, { depth: 16, weight: 28 }] },
    ],
    '4h': [
      { name: 'all-in @ close<EMA', tiers: [{ depth: 0, weight: 100 }] },
      { name: 'flat 3 (1.5/3/6)', tiers: [{ depth: 1.5, weight: 33.34 }, { depth: 3, weight: 33.33 }, { depth: 6, weight: 33.33 }] },
      { name: 'flat 4 (1.5/3/5/8)', tiers: [{ depth: 1.5, weight: 25 }, { depth: 3, weight: 25 }, { depth: 5, weight: 25 }, { depth: 8, weight: 25 }] },
      { name: 'flat 5 (1/2.5/4/6/10)', tiers: [{ depth: 1, weight: 20 }, { depth: 2.5, weight: 20 }, { depth: 4, weight: 20 }, { depth: 6, weight: 20 }, { depth: 10, weight: 20 }] },
      { name: 'front 4 (40/30/20/10)', tiers: [{ depth: 1.5, weight: 40 }, { depth: 3, weight: 30 }, { depth: 5, weight: 20 }, { depth: 8, weight: 10 }] },
      { name: 'back 4 (10/20/30/40)', tiers: [{ depth: 1.5, weight: 10 }, { depth: 3, weight: 20 }, { depth: 5, weight: 30 }, { depth: 8, weight: 40 }] },
      { name: 'back 5 (10/15/20/25/30)', tiers: [{ depth: 1, weight: 10 }, { depth: 2.5, weight: 15 }, { depth: 4, weight: 20 }, { depth: 6, weight: 25 }, { depth: 10, weight: 30 }] },
      { name: 'deep-only 3 (4/7/12)', tiers: [{ depth: 4, weight: 33.34 }, { depth: 7, weight: 33.33 }, { depth: 12, weight: 33.33 }] },
      { name: 'mild-back 4 (20/25/27/28)', tiers: [{ depth: 1.5, weight: 20 }, { depth: 3, weight: 25 }, { depth: 5, weight: 27 }, { depth: 8, weight: 28 }] },
    ],
  };

  for (const interval of intervals) {
    const candles = await fetchKlines(symbol, interval, startMs, endMs);
    const closes = candles.map((c) => c.close);
    const e = ema(closes, emaPeriod);
    const span = candles.length
      ? `${candles[0]!.openTime.toISOString().slice(0, 10)} → ${candles[candles.length - 1]!.openTime.toISOString().slice(0, 10)}`
      : 'no data';
    const years = candles.length ? (candles[candles.length - 1]!.openTime.getTime() - candles[0]!.openTime.getTime()) / (365.25 * 864e5) : 0;

    console.log(`\n============ ${symbol} ${interval} | EMA${emaPeriod} | ${candles.length} candles (${span}) | $${capital} | fee ${feePerSide}%/side ============`);

    // Per-depth fill probability — the raw input for sizing each tier.
    const grid = interval === '1d' ? [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30] : [0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 15];
    const ds = depthStats(candles, e, emaPeriod, grid);
    console.log(`\n-- fill probability per depth tier (${ds.cycles} cycles, no lookahead) --`);
    console.log('depth% | cycles filled | fill rate | avg bars to fill | med bars');
    for (let t = 0; t < grid.length; t++) {
      const b = [...ds.barsToFill[t]!].sort((a, z) => a - z);
      const avg = b.length ? b.reduce((a, z) => a + z, 0) / b.length : NaN;
      console.log(
        `${fmt(grid[t]!, 1).padStart(6)} | ${String(ds.cyclesFilled[t]).padStart(13)} | ${fmt((ds.cyclesFilled[t]! / ds.cycles) * 100, 1).padStart(8)}% | ${fmt(avg, 1).padStart(16)} | ${fmt(quantile(b, 0.5), 1).padStart(8)}`,
      );
    }
    console.log('');
    const ladders = laddersByTf[interval] ?? [];
    console.log('ladder                   | cyc | filled | deploy% | avgDisc% | ret/cyc% | final$   | CAGR% | maxDD% | worstUnr% | avgBars | tier fill rates');
    for (const L of ladders) {
      const r = runLadder(candles, e, emaPeriod, L, feePerSide);
      const used = r.cycles.filter((c) => c.deployedFrac > 0);
      const finalPool = r.equityCurve.length ? r.equityCurve[r.equityCurve.length - 1]! : 1;
      const finalEquity = capital * finalPool;
      const cagr = years > 0 ? (Math.pow(finalPool, 1 / years) - 1) * 100 : NaN;
      const avgDeploy = used.length ? (used.reduce((s, c) => s + c.deployedFrac, 0) / used.length) * 100 : 0;
      const avgDisc = used.length ? used.reduce((s, c) => s + c.avgDiscount, 0) / used.length : 0;
      const avgRet = used.length ? (used.reduce((s, c) => s + c.poolRet, 0) / used.length) * 100 : 0;
      const avgBars = used.length ? used.reduce((s, c) => s + c.bars, 0) / used.length : 0;
      const worstUnr = used.length ? Math.min(...used.map((c) => c.worstUnreal)) * 100 : 0;
      const fillRates = r.fills.map((f, i) => `${L.tiers[i]!.depth}%:${((f / r.cycles.length) * 100).toFixed(0)}%`).join(' ');
      console.log(
        `${L.name.padEnd(24)} | ${String(r.cycles.length).padStart(3)} | ${String(used.length).padStart(6)} | ${fmt(avgDeploy, 1).padStart(7)} | ${fmt(avgDisc, 2).padStart(8)} | ${fmt(avgRet, 2).padStart(8)} | ${('$' + fmt(finalEquity, 0)).padStart(8)} | ${fmt(cagr, 1).padStart(5)} | ${fmt(maxDrawdown(r.equityCurve), 1).padStart(6)} | ${fmt(worstUnr, 1).padStart(9)} | ${fmt(avgBars, 1).padStart(7)} | ${fillRates}`,
      );
    }

    // Buy & hold benchmark over the same window.
    if (candles.length) {
      const bh = candles[candles.length - 1]!.close / candles[emaPeriod]!.close;
      console.log(`${'BUY & HOLD (benchmark)'.padEnd(24)} | ${''.padStart(3)} | ${''.padStart(6)} | ${'100.0'.padStart(7)} | ${''.padStart(8)} | ${''.padStart(8)} | ${('$' + fmt(capital * bh, 0)).padStart(8)} | ${fmt((Math.pow(bh, 1 / years) - 1) * 100, 1).padStart(5)} |`);
    }

    // Per-cycle return distribution for the best few ladders is printed separately.
    console.log('\n-- per-cycle pool return distribution (cycles that deployed capital) --');
    console.log('ladder                   | p10    | p25    | med    | p75    | p90    | worst  | best');
    for (const L of ladders) {
      const r = runLadder(candles, e, emaPeriod, L, feePerSide);
      const rets = r.cycles.filter((c) => c.deployedFrac > 0).map((c) => c.poolRet * 100).sort((a, b) => a - b);
      if (!rets.length) continue;
      console.log(
        `${L.name.padEnd(24)} | ${fmt(quantile(rets, 0.1)).padStart(6)} | ${fmt(quantile(rets, 0.25)).padStart(6)} | ${fmt(quantile(rets, 0.5)).padStart(6)} | ${fmt(quantile(rets, 0.75)).padStart(6)} | ${fmt(quantile(rets, 0.9)).padStart(6)} | ${fmt(rets[0]!).padStart(6)} | ${fmt(rets[rets.length - 1]!).padStart(6)}`,
      );
    }
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
