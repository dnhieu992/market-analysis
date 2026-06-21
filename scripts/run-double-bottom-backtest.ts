/**
 * Price-pattern backtest: DOUBLE BOTTOM (mô hình 2 đáy) — LONG only, H4.
 *
 * Detection (confirmed pivots via fractal lookback L on each side):
 *   - Pivot low  at i: low[i]  = min(low[i-L .. i+L])
 *   - Pivot high at i: high[i] = max(high[i-L .. i+L])
 *   A double bottom = two pivot lows L1, L2 with a pivot high P (neckline) between them where:
 *     - |L2 - L1| / L1 <= tolPct                 (the two bottoms are ~equal)
 *     - barsBetween in [minGap, maxGap]
 *     - height = (P - bottom)/bottom >= minHeightPct   (bottom = min(L1,L2))
 *
 * Entry: first candle that CLOSES above the neckline P, within `entryWindow` bars after L2 confirms.
 *        Entry price = that close.
 * Stop:  below the bottom — SL = bottom * (1 - slBufPct).
 * Target: measured move — TP = neckline + tpMult * (neckline - bottom).
 * Exit:  whichever of SL/TP is touched first intra-candle. If both in one candle → assume SL first
 *        (conservative). Otherwise exit on a UTBot-style timeout? No — pattern trade rides to TP/SL.
 *
 * Capital: $startCap compounded, full position each trade, fee feePct%/side. One position at a time.
 *
 * Usage: ts-node --project apps/api/tsconfig.json scripts/run-double-bottom-backtest.ts \
 *   [days] [feePctPerSide] [startCap] [L] [tolPct] [minHeightPct] [tpMult] [entryWindow] [maxGap]
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const INTERVAL = '4h';
const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT'];

type Candle = { open: number; high: number; low: number; close: number; openTime: number };

function fetchJson(url: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}
async function fetchKlines(symbol: string, interval: string, startMs: number, endMs: number): Promise<Candle[]> {
  const out: Candle[] = []; let cur = startMs;
  while (cur < endMs) {
    const url = `${BINANCE_HOST}?symbol=${symbol}&interval=${interval}&startTime=${cur}&endTime=${endMs}&limit=${MAX_PER_REQ}`;
    const batch = (await fetchJson(url)) as unknown[][];
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const k of batch) out.push({ open: +(k[1] as string), high: +(k[2] as string), low: +(k[3] as string), close: +(k[4] as string), openTime: k[0] as number });
    if (batch.length < MAX_PER_REQ) break;
    cur = (batch[batch.length - 1]![0] as number) + 1;
  }
  return out;
}

const fmt = (n: number, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

type Pivot = { idx: number; price: number; kind: 'low' | 'high' };

// confirmed pivots: a pivot at i is known only at i+L
function findPivots(c: Candle[], L: number): Pivot[] {
  const out: Pivot[] = [];
  for (let i = L; i < c.length - L; i++) {
    let isLow = true, isHigh = true;
    for (let j = i - L; j <= i + L; j++) {
      if (j === i) continue;
      if (c[j]!.low <= c[i]!.low) isLow = false;
      if (c[j]!.high >= c[i]!.high) isHigh = false;
    }
    if (isLow) out.push({ idx: i, price: c[i]!.low, kind: 'low' });
    if (isHigh) out.push({ idx: i, price: c[i]!.high, kind: 'high' });
  }
  return out.sort((a, b) => a.idx - b.idx);
}

type Cfg = { L: number; tolPct: number; minHeightPct: number; tpMult: number; entryWindow: number; minGap: number; maxGap: number; slBufPct: number };
type TradeRes = { trades: number; wins: number; losses: number; retPct: number; finalEq: number; maxDD: number; sumR: number };

function run(c: Candle[], startCap: number, feePct: number, cfg: Cfg): TradeRes {
  const piv = findPivots(c, cfg.L);
  const f = feePct / 100;
  const lows = piv.filter((p) => p.kind === 'low');
  let eq = startCap, peak = startCap, maxDD = 0, trades = 0, wins = 0, losses = 0, sumR = 0;
  let busyUntil = -1; // index up to which we're in a trade (no overlapping patterns)

  for (let a = 0; a < lows.length; a++) {
    for (let b = a + 1; b < lows.length; b++) {
      const L1 = lows[a]!, L2 = lows[b]!;
      const gap = L2.idx - L1.idx;
      if (gap < cfg.minGap) continue;
      if (gap > cfg.maxGap) break;
      if (Math.abs(L2.price - L1.price) / L1.price > cfg.tolPct / 100) continue;
      // neckline = highest pivot-high strictly between the two bottoms
      const between = piv.filter((p) => p.kind === 'high' && p.idx > L1.idx && p.idx < L2.idx);
      if (between.length === 0) continue;
      const neck = Math.max(...between.map((p) => p.price));
      const bottom = Math.min(L1.price, L2.price);
      const height = (neck - bottom) / bottom;
      if (height < cfg.minHeightPct / 100) continue;

      // L2 confirmed at L2.idx + L; entry can only happen after that
      const confirmIdx = L2.idx + cfg.L;
      if (confirmIdx <= busyUntil) continue; // skip patterns overlapping an open trade
      let entryIdx = -1;
      for (let i = confirmIdx + 1; i <= confirmIdx + cfg.entryWindow && i < c.length; i++) {
        if (c[i]!.close > neck) { entryIdx = i; break; }
      }
      if (entryIdx === -1) continue;

      const entry = c[entryIdx]!.close;
      const sl = bottom * (1 - cfg.slBufPct / 100);
      const tp = neck + cfg.tpMult * (neck - bottom);
      if (entry <= sl) continue; // already invalid

      // walk forward to exit
      let exitPx = c[c.length - 1]!.close, exitIdx = c.length - 1, outcome: 'tp' | 'sl' | 'eod' = 'eod';
      for (let i = entryIdx + 1; i < c.length; i++) {
        const hitSL = c[i]!.low <= sl, hitTP = c[i]!.high >= tp;
        if (hitSL && hitTP) { exitPx = sl; exitIdx = i; outcome = 'sl'; break; } // conservative
        if (hitSL) { exitPx = sl; exitIdx = i; outcome = 'sl'; break; }
        if (hitTP) { exitPx = tp; exitIdx = i; outcome = 'tp'; break; }
      }

      const grossRet = (exitPx - entry) / entry;
      const netMult = (1 + grossRet) * (1 - f) * (1 - f); // fee both sides
      const pnl = eq * netMult - eq;
      eq += pnl;
      trades++;
      if (outcome === 'tp') wins++; else if (outcome === 'sl') losses++; else if (grossRet >= 0) wins++; else losses++;
      const r = (exitPx - entry) / (entry - sl);
      sumR += r;
      peak = Math.max(peak, eq);
      maxDD = Math.max(maxDD, (peak - eq) / peak);
      busyUntil = exitIdx;
      break; // one pattern per L1; move on
    }
  }
  return { trades, wins, losses, retPct: (eq / startCap - 1) * 100, finalEq: eq, maxDD: maxDD * 100, sumR };
}

async function main() {
  const [, , daysA, feeA, capA, lA, tolA, hA, tpA, ewA, gapA] = process.argv;
  const days = Number(daysA ?? 365), fee = Number(feeA ?? 0.05), cap = Number(capA ?? 1000);
  const cfg: Cfg = {
    L: Number(lA ?? 3), tolPct: Number(tolA ?? 3), minHeightPct: Number(hA ?? 2),
    tpMult: Number(tpA ?? 1), entryWindow: Number(ewA ?? 24), minGap: 6, maxGap: Number(gapA ?? 80), slBufPct: 0.2,
  };
  const endMs = Date.now(), startMs = endMs - days * 864e5;

  console.log(`\n=== DOUBLE BOTTOM (2 đáy) — LONG only · ${INTERVAL} · ${days}d · $${cap} compounded · fee ${fee}%/side ===`);
  console.log(`params: pivotL=${cfg.L} · tol=${cfg.tolPct}% · minHeight=${cfg.minHeightPct}% · TP=${cfg.tpMult}×height · entryWindow=${cfg.entryWindow}b · gap=[${cfg.minGap},${cfg.maxGap}] · SLbuf=${cfg.slBufPct}%`);
  console.log('\n  symbol     | trades | win  | loss | winRate |  return%  | maxDD% | avgR');
  let T = { trades: 0, wins: 0, losses: 0, sumR: 0 };
  for (const sym of SYMBOLS) {
    const c = await fetchKlines(sym, INTERVAL, startMs, endMs);
    const r = run(c, cap, fee, cfg);
    const wr = r.trades ? (r.wins / r.trades) * 100 : 0;
    const avgR = r.trades ? r.sumR / r.trades : 0;
    console.log(
      `  ${sym.padEnd(10)} | ${String(r.trades).padStart(6)} | ${String(r.wins).padStart(4)} | ${String(r.losses).padStart(4)} | ` +
        `${(fmt(wr, 1) + '%').padStart(7)} | ${(fmt(r.retPct, 1) + '%').padStart(9)} | ${fmt(r.maxDD, 1).padStart(6)} | ${fmt(avgR, 2).padStart(5)}`,
    );
    T.trades += r.trades; T.wins += r.wins; T.losses += r.losses; T.sumR += r.sumR;
  }
  const twr = T.trades ? (T.wins / T.trades) * 100 : 0;
  console.log(`\n  TOTAL: ${T.trades} trades · winRate ${fmt(twr, 1)}% · avgR ${fmt(T.trades ? T.sumR / T.trades : 0, 2)} (expectancy per trade in R)\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
