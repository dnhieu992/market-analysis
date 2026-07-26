/**
 * Backtest: BOTTOM-ACCUMULATION DCA → hold for x2/x3 (spot, NO stop-loss),
 * comparing TWO ladder placement rules:
 *
 *   ladderMode=fixed  — the shipped rule: tranche k fills at firstEntry × (1 − step×k).
 *   ladderMode=zone   — tranches fill at HARD SUPPORT ZONES below the entry instead.
 *
 * Everything else (entry gate, tier count, equal-USD sizing, x2/x3 exit, fees) is held
 * identical so the ladder rule is the only variable. Companion to the fixed-step sweep in
 * `claude-backtest/runs/2026-07-12-bottom-dca-step-sweep.md`.
 *
 * ── How a zone ladder is built (all of it causal — only bars strictly before entry) ──
 *   1. Pivot lows over the last `zoneLookback` bars: bar j is a pivot when its low is the
 *      minimum of [j−pivotK, j+pivotK]. A pivot is only *known* at j+pivotK, so we require
 *      j + pivotK ≤ i−1. No lookahead.
 *   2. Cluster pivots whose lows sit within `zoneTolPct` of each other; a cluster is a zone,
 *      its price = the cluster's MEAN low, its strength = number of touches.
 *   3. Keep zones with ≥ `minTouches` touches that lie below the first entry, no deeper than
 *      `maxDepthPct`. Walk them top-down, taking one only when it is at least `minGapPct`
 *      below the previously taken level (stops two zones 3% apart eating two tranches).
 *   4. Not enough qualifying zones → the remaining tranches FALL BACK to the fixed step.
 *      This is the common case for coins printing new lows, which is most of this universe —
 *      the run reports how often it happens.
 *
 * NOTE: the live dcaScore ≥ 50 survival gate (market cap + weekly trend) is NOT reproduced
 * historically (market cap is not available per-bar). The basket is already the curated
 * /tracking-coins universe; treat the tail here as the upper bound of what the gate must filter.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-bottom-dca-zone-ladder-backtest.ts \
 *     [days] [capital] [feePctPerSide] [ddMin] [ddMax] [rangeLen] [rangeMaxPct] \
 *     [lowZone] [rsiMax] [peakLookback] [tiers] [addStepPct] [t1Mult] [t2Mult] [sellFrac] \
 *     [ladderMode] [zoneLookback] [pivotK] [zoneTolPct] [minTouches] [minGapPct] [maxDepthPct]
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;

const FULL_BASKET = [
  'BTC', 'ETH', 'ADA', 'SOL', 'TAO', 'SEI', 'BNB', 'XRP', 'DOGE', 'ZEC',
  'XLM', 'LINK', 'BCH', 'HBAR', 'LTC', 'SUI', 'AVAX', 'SHIB', 'NEAR', 'WLFI',
  'UNI', 'WLD', 'ASTER', 'ONDO', 'DOT', 'AAVE', 'ICP', 'ETC', 'PEPE', 'ATOM',
  'ENA', 'POL', 'FIL', 'APT', 'ARB', 'INJ',
];
// Override the universe with env BASKET="BTC,ETH,..." to simulate the dcaScore survival gate.
const BASKET = (process.env.BASKET ? process.env.BASKET.split(',').map((s) => s.trim()).filter(Boolean) : FULL_BASKET)
  .map((s) => `${s}USDT`);

type Candle = { high: number; low: number; close: number; volume: number; openTime: Date };

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
    let batch: unknown[][];
    try { batch = (await fetchJson(url)) as unknown[][]; } catch { break; }
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const k of batch) {
      out.push({ high: parseFloat(k[2] as string), low: parseFloat(k[3] as string), close: parseFloat(k[4] as string), volume: parseFloat(k[5] as string), openTime: new Date(k[0] as number) });
    }
    if (batch.length < MAX_PER_REQ) break;
    cur = (batch[batch.length - 1]![0] as number) + 1;
  }
  return out;
}

function fmt(n: number, d = 2): string { return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }

function rsiSeries(closes: number[], period = 14): number[] {
  const out = new Array(closes.length).fill(NaN);
  if (closes.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i]! - closes[i - 1]!;
    if (ch >= 0) gain += ch; else loss -= ch;
  }
  gain /= period; loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i]! - closes[i - 1]!;
    gain = (gain * (period - 1) + Math.max(ch, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-ch, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

type Cfg = {
  ddMin: number; ddMax: number; rangeLen: number; rangeMaxPct: number;
  lowZone: number; rsiMax: number; peakLookback: number;
  tiers: number; addStepPct: number; t1Mult: number; t2Mult: number; sellFrac: number;
  feePerSide: number; capital: number;
  ladderMode: 'fixed' | 'zone';
  zoneLookback: number; pivotK: number; zoneTolPct: number;
  minTouches: number; minGapPct: number; maxDepthPct: number;
};

type Zone = { price: number; touches: number };

/**
 * Cluster pivot lows in `candles[from..toExclusive)` into support zones.
 * Only pivots CONFIRMED by bar `toExclusive-1` are used (a pivot needs pivotK bars to its
 * right), so this never sees the future.
 */
function buildSupportZones(candles: Candle[], from: number, toExclusive: number, cfg: Cfg): Zone[] {
  const k = cfg.pivotK;
  const lows: number[] = [];
  for (let j = Math.max(from, k); j + k <= toExclusive - 1; j++) {
    const lo = candles[j]!.low;
    let isPivot = true;
    for (let m = j - k; m <= j + k && isPivot; m++) if (candles[m]!.low < lo) isPivot = false;
    if (isPivot) lows.push(lo);
  }
  if (lows.length === 0) return [];

  // Greedy clustering on sorted lows: grow a cluster while the next low is within tolerance
  // of the cluster's running mean.
  lows.sort((a, b) => a - b);
  const zones: Zone[] = [];
  let cluster: number[] = [lows[0]!];
  for (let idx = 1; idx < lows.length; idx++) {
    const mean = cluster.reduce((s, v) => s + v, 0) / cluster.length;
    if (Math.abs(lows[idx]! - mean) / mean <= cfg.zoneTolPct) {
      cluster.push(lows[idx]!);
    } else {
      zones.push({ price: mean, touches: cluster.length });
      cluster = [lows[idx]!];
    }
  }
  const mean = cluster.reduce((s, v) => s + v, 0) / cluster.length;
  zones.push({ price: mean, touches: cluster.length });
  return zones;
}

/**
 * Ladder prices for tranches 2..tiers. Returns the levels plus how many came from a real
 * support zone (the rest fell back to the fixed step).
 */
function buildLadder(candles: Candle[], i: number, firstEntry: number, cfg: Cfg): { levels: number[]; fromZone: number } {
  const need = cfg.tiers - 1;
  const fixedLevels = Array.from({ length: need }, (_, t) => firstEntry * (1 - cfg.addStepPct * (t + 1)));
  if (cfg.ladderMode === 'fixed') return { levels: fixedLevels, fromZone: 0 };

  const zones = buildSupportZones(candles, Math.max(0, i - cfg.zoneLookback), i, cfg)
    .filter((z) => z.touches >= cfg.minTouches)
    .filter((z) => z.price < firstEntry && z.price >= firstEntry * (1 - cfg.maxDepthPct))
    .sort((a, b) => b.price - a.price); // nearest support first

  const levels: number[] = [];
  let prev = firstEntry;
  for (const z of zones) {
    if (levels.length >= need) break;
    if (z.price <= prev * (1 - cfg.minGapPct)) { levels.push(z.price); prev = z.price; }
  }
  const fromZone = levels.length;

  // Fall back to fixed spacing for whatever the zones could not supply.
  while (levels.length < need) {
    const next = prev * (1 - cfg.addStepPct);
    levels.push(next);
    prev = next;
  }
  return { levels, fromZone };
}

type Camp = {
  symbol: string; entryTime: Date; exitTime: Date;
  reason: 'x3' | 'x2-partial-open' | 'open'; tiersFilled: number;
  deployed: number; realizedMult: number; retPct: number; maePct: number; bars: number;
  /** How many of the planned add-tranches came from a real support zone vs the fixed fallback. */
  zoneLevels: number; plannedLevels: number;
};

function runCoin(symbol: string, candles: Candle[], cfg: Cfg): { camps: Camp[] } {
  const closes = candles.map((c) => c.close);
  const rsi = rsiSeries(closes, 14);
  const fee = cfg.feePerSide / 100;
  const perTierUsd = cfg.capital / cfg.tiers;
  const camps: Camp[] = [];
  const warmup = Math.max(cfg.peakLookback, cfg.rangeLen) + 1;

  type Pos = {
    firstEntry: number; entryTime: Date; entryIdx: number;
    qty: number; deployed: number; realized: number; tiersFilled: number;
    soldT1: boolean; mae: number;
    /** Add-tranche prices decided ONCE at entry (index 0 = tranche 2). */
    levels: number[]; fromZone: number;
  };
  let pos: Pos | null = null;

  const avgCost = (p: Pos) => p.deployed / p.qty; // avg price paid per coin (incl. buy fee drag)

  for (let i = warmup; i < candles.length; i++) {
    const c = candles[i]!;

    if (pos) {
      // track deepest underwater vs current avg cost
      const dd = (avgCost(pos) - c.low) / avgCost(pos);
      if (dd > pos.mae) pos.mae = dd;

      // ── add a tranche when price reaches the next planned level ──
      if (pos.tiersFilled < cfg.tiers) {
        const nextAddPrice = pos.levels[pos.tiersFilled - 1]!;
        if (c.low <= nextAddPrice) {
          const fillPx = Math.min(c.close, nextAddPrice); // fill at the tier line (or better on close)
          pos.qty += (perTierUsd * (1 - fee)) / fillPx;
          pos.deployed += perTierUsd;
          pos.tiersFilled += 1;
        }
      }

      const cost = avgCost(pos);
      // ── take-profit: half at x2, rest at x3 (off average cost) ──
      if (!pos.soldT1 && c.high >= cost * cfg.t1Mult) {
        const px = cost * cfg.t1Mult;
        const sellQty = pos.qty * cfg.sellFrac;
        pos.realized += sellQty * px * (1 - fee);
        pos.qty -= sellQty;
        pos.soldT1 = true;
      }
      if (pos.soldT1 && c.high >= cost * cfg.t2Mult) {
        const px = cost * cfg.t2Mult;
        pos.realized += pos.qty * px * (1 - fee);
        const finalEq = (cfg.capital - pos.deployed) + pos.realized;
        camps.push({
          symbol, entryTime: pos.entryTime, exitTime: c.openTime, reason: 'x3',
          tiersFilled: pos.tiersFilled, deployed: pos.deployed,
          realizedMult: pos.realized / pos.deployed, retPct: (finalEq - cfg.capital) / cfg.capital * 100,
          maePct: pos.mae * 100, bars: i - pos.entryIdx,
          zoneLevels: pos.fromZone, plannedLevels: pos.levels.length,
        });
        pos = null;
      }
      continue;
    }

    // ── strong-bottom accumulation entry test ──
    let rangeHigh = -Infinity, rangeLow = Infinity, peak = -Infinity;
    for (let j = i - cfg.rangeLen; j < i; j++) { if (candles[j]!.high > rangeHigh) rangeHigh = candles[j]!.high; if (candles[j]!.low < rangeLow) rangeLow = candles[j]!.low; }
    for (let j = i - cfg.peakLookback; j < i; j++) if (candles[j]!.high > peak) peak = candles[j]!.high;

    const dd = peak > 0 ? (peak - c.close) / peak : 0;
    const baseWidth = rangeLow > 0 ? (rangeHigh - rangeLow) / rangeLow : Infinity;
    const inLowerBase = c.close <= rangeLow * (1 + cfg.lowZone);
    const rsiOk = cfg.rsiMax >= 100 || (!isNaN(rsi[i]!) && rsi[i]! <= cfg.rsiMax);

    if (dd >= cfg.ddMin && dd <= cfg.ddMax && baseWidth <= cfg.rangeMaxPct && inLowerBase && rsiOk) {
      const { levels, fromZone } = buildLadder(candles, i, c.close, cfg);
      pos = { firstEntry: c.close, entryTime: c.openTime, entryIdx: i, qty: (perTierUsd * (1 - fee)) / c.close, deployed: perTierUsd, realized: 0, tiersFilled: 1, soldT1: false, mae: 0, levels, fromZone };
    }
  }

  if (pos) {
    const last = candles[candles.length - 1]!;
    pos.realized += pos.qty * last.close * (1 - fee); // mark bag to market
    const finalEq = (cfg.capital - pos.deployed) + pos.realized;
    camps.push({
      symbol, entryTime: pos.entryTime, exitTime: last.openTime,
      reason: pos.soldT1 ? 'x2-partial-open' : 'open',
      tiersFilled: pos.tiersFilled, deployed: pos.deployed,
      realizedMult: pos.realized / pos.deployed, retPct: (finalEq - cfg.capital) / cfg.capital * 100,
      maePct: pos.mae * 100, bars: candles.length - 1 - pos.entryIdx,
      zoneLevels: pos.fromZone, plannedLevels: pos.levels.length,
    });
  }
  return { camps };
}

async function main() {
  const a = process.argv.slice(2);
  const days = Number(a[0] ?? 1460);
  const capital = Number(a[1] ?? 1000);
  const feePerSide = Number(a[2] ?? 0.05);
  const ddMin = Number(a[3] ?? 0.5);
  const ddMax = Number(a[4] ?? 0.85);
  const rangeLen = Number(a[5] ?? 30);
  const rangeMaxPct = Number(a[6] ?? 0.25);
  const lowZone = Number(a[7] ?? 0.08);
  const rsiMax = Number(a[8] ?? 45);
  const peakLookback = Number(a[9] ?? 500);
  const tiers = Number(a[10] ?? 3);
  const addStepPct = Number(a[11] ?? 0.15);
  const t1Mult = Number(a[12] ?? 2.0);
  const t2Mult = Number(a[13] ?? 3.0);
  const sellFrac = Number(a[14] ?? 0.5);
  const ladderMode = ((a[15] ?? 'fixed') === 'zone' ? 'zone' : 'fixed') as 'fixed' | 'zone';
  const zoneLookback = Number(a[16] ?? 500);
  const pivotK = Number(a[17] ?? 3);
  const zoneTolPct = Number(a[18] ?? 0.03);
  const minTouches = Number(a[19] ?? 2);
  const minGapPct = Number(a[20] ?? 0.08);
  const maxDepthPct = Number(a[21] ?? 0.6);

  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;
  console.log(`\nFetching ${BASKET.length} coins, D1, ${days}d ...`);
  const data: Record<string, Candle[]> = {};
  for (const sym of BASKET) {
    const c = await fetchKlines(sym, '1d', startMs, endMs);
    if (c.length >= peakLookback + rangeLen + 10) data[sym] = c;
    process.stdout.write(`${sym}:${c.length} `);
  }
  console.log('\n');

  const cfg: Cfg = { ddMin, ddMax, rangeLen, rangeMaxPct, lowZone, rsiMax, peakLookback, tiers, addStepPct, t1Mult, t2Mult, sellFrac, feePerSide, capital, ladderMode, zoneLookback, pivotK, zoneTolPct, minTouches, minGapPct, maxDepthPct };
  console.log(`=== BOTTOM-DCA → x2/x3, NO STOP-LOSS | D1 | $${capital}/coin | fee ${feePerSide}%/side ===`);
  console.log(`    entry dd ${ddMin}-${ddMax} from ${peakLookback}d peak | base ${rangeLen}d ≤${rangeMaxPct * 100}% | buy ≤low+${lowZone * 100}% | RSI≤${rsiMax}`);
  console.log(`    ladder ${tiers} tiers, mode ${ladderMode.toUpperCase()} | exit ${sellFrac * 100}% @ x${t1Mult}, rest @ x${t2Mult}`);
  console.log(ladderMode === 'zone'
    ? `    zones: ${zoneLookback}d lookback, pivotK ${pivotK}, tol ±${zoneTolPct * 100}%, ≥${minTouches} touches, gap ≥${minGapPct * 100}%, max depth ${maxDepthPct * 100}% | fallback step −${addStepPct * 100}%`
    : `    fixed step: add every −${addStepPct * 100}% below first entry`);
  console.log(`    coins with data: ${Object.keys(data).length}/${BASKET.length}\n`);

  const all: Camp[] = [];
  const perCoin: { sym: string; n: number; hitX3: number; hitX2: number; open: number; avgRet: number; worstMae: number; net: number }[] = [];
  for (const [sym, candles] of Object.entries(data)) {
    const { camps } = runCoin(sym, candles, cfg);
    if (camps.length === 0) continue;
    all.push(...camps);
    const hitX3 = camps.filter((c) => c.reason === 'x3').length;
    const hitX2 = camps.filter((c) => c.reason === 'x2-partial-open').length;
    const open = camps.filter((c) => c.reason === 'open').length;
    const net = camps.reduce((s, c) => s + c.retPct, 0);
    perCoin.push({ sym, n: camps.length, hitX3, hitX2, open, avgRet: net / camps.length, worstMae: Math.max(...camps.map((c) => c.maePct)), net });
  }

  perCoin.sort((x, y) => y.net - x.net);
  console.log('symbol     | camps | x3 | x2 | open | avgRet% |  netRet% | worstMAE%');
  for (const p of perCoin) {
    console.log(`${p.sym.padEnd(10)} | ${String(p.n).padStart(5)} | ${String(p.hitX3).padStart(2)} | ${String(p.hitX2).padStart(2)} | ${String(p.open).padStart(4)} | ${(p.avgRet >= 0 ? '+' : '') + fmt(p.avgRet)}% | ${(p.net >= 0 ? '+' : '') + fmt(p.net)}% | ${fmt(p.worstMae).padStart(8)}%`);
  }

  const n = all.length;
  const wins = all.filter((c) => c.retPct > 0);
  const hitX3 = all.filter((c) => c.reason === 'x3').length;
  const hitX2 = all.filter((c) => c.reason === 'x2-partial-open').length;
  const openN = all.filter((c) => c.reason === 'open').length;
  const grossW = wins.reduce((s, c) => s + c.retPct, 0);
  const grossL = all.filter((c) => c.retPct <= 0).reduce((s, c) => s + Math.abs(c.retPct), 0);
  const er = n ? all.reduce((s, c) => s + c.retPct, 0) / n : 0;
  const avgMae = n ? all.reduce((s, c) => s + c.maePct, 0) / n : 0;
  const worstMae = n ? Math.max(...all.map((c) => c.maePct)) : 0;
  const avgBars = n ? all.reduce((s, c) => s + c.bars, 0) / n : 0;
  const avgTiers = n ? all.reduce((s, c) => s + c.tiersFilled, 0) / n : 0;
  console.log(`\nTOTAL: ${n} camps | reached x3 ${hitX3} | partial-x2-then-open ${hitX2} | never-hit-x2 (bag) ${openN}`);
  console.log(`       winRate ${fmt(n ? wins.length / n * 100 : 0)}% | E[R]/camp ${(er >= 0 ? '+' : '') + fmt(er)}% | PF ${grossL > 0 ? fmt(grossW / grossL) : '∞'}`);
  console.log(`       avg MAE ${fmt(avgMae)}% | worst MAE ${fmt(worstMae)}% | avg hold ${fmt(avgBars, 0)}d | avg tiers filled ${fmt(avgTiers, 1)}/${tiers}`);
  if (cfg.ladderMode === 'zone') {
    const planned = all.reduce((s2, c) => s2 + c.plannedLevels, 0);
    const fromZone = all.reduce((s2, c) => s2 + c.zoneLevels, 0);
    const fullyZoned = all.filter((c) => c.zoneLevels === c.plannedLevels).length;
    const noZone = all.filter((c) => c.zoneLevels === 0).length;
    console.log(`       ZONE COVERAGE: ${fromZone}/${planned} add-levels from real support (${fmt(planned ? fromZone / planned * 100 : 0)}%)`);
    console.log(`                      ${fullyZoned}/${n} campaigns fully zone-placed | ${noZone}/${n} fell back entirely to −${addStepPct * 100}%`);
  }
  console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
