/**
 * BTC SHORT · Asian-session S/R-channel resistance fade on M30.
 *
 * Rule (each UTC day):
 *   1. Build an M30 resistance channel from confirmed pivot highs (swing highs).
 *      A pivot high = a bar whose high is the max over `piv` bars left AND `piv` bars right
 *      (only pivots CONFIRMED before 00:00 of the trading day are eligible — no look-ahead).
 *      Overhead pivots (above the 00:00 window-open price) are clustered into a zone when
 *      within `chanW`% of each other; the nearest zone above price is the active resistance.
 *      Its LOWER edge is the short trigger. `minTouch` = min pivots required in the zone.
 *   2. Entry window = [entryStart..entryEnd) UTC (Asian session, default 00:00–06:00).
 *      If any M30 candle's high reaches the zone lower edge → SHORT (limit fill at that edge).
 *      One entry per day.
 *   3. TP = entry − tpPts (absolute price points, default 500). If any later candle's low
 *      trades to TP → exit there (win). NO stop.
 *   4. Force-close at exitHour (default 16:00 UTC = open of the 16:00 candle) if TP not hit.
 *
 * Fee feePct%/side. Reports fixed-$notional/trade P&L AND $1000-compounded final equity.
 *
 * Usage: ts-node --project apps/api/tsconfig.json scripts/run-btc-short-asia-srchannel-m30-backtest.ts \
 *   [startISO] [tpPts] [piv] [chanWpct] [minTouch] [entryStart] [entryEnd] [exitHour] [feePctPerSide] [notional]
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const SYMBOL = 'BTCUSDT', INTERVAL = '30m';
const HALFHOUR_MS = 30 * 60 * 1000, DAY_MS = 864e5;

type C = { open: number; high: number; low: number; close: number; openTime: number; hour: number; day: number };

function fetchJson(url: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}
async function fetchKlines(symbol: string, interval: string, startMs: number, endMs: number): Promise<C[]> {
  const out: C[] = []; let cur = startMs;
  while (cur < endMs) {
    const url = `${BINANCE_HOST}?symbol=${symbol}&interval=${interval}&startTime=${cur}&endTime=${endMs}&limit=${MAX_PER_REQ}`;
    const batch = (await fetchJson(url)) as unknown[][];
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const k of batch) {
      const t = k[0] as number;
      out.push({ open: +(k[1] as string), high: +(k[2] as string), low: +(k[3] as string), close: +(k[4] as string), openTime: t, hour: new Date(t).getUTCHours(), day: Math.floor(t / DAY_MS) });
    }
    if (batch.length < MAX_PER_REQ) break;
    cur = (batch[batch.length - 1]![0] as number) + 1;
  }
  return out;
}

const fmt = (n: number, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const usd = (n: number) => (n >= 0 ? '+$' : '-$') + fmt(Math.abs(n));

/** Confirmed pivot highs: index i is a pivot if high[i] is strict max over [i-piv, i+piv]. Returns {idx, price}. */
function pivotHighs(c: C[], piv: number): { idx: number; price: number }[] {
  const out: { idx: number; price: number }[] = [];
  for (let i = piv; i < c.length - piv; i++) {
    const h = c[i]!.high; let ok = true;
    for (let j = i - piv; j <= i + piv; j++) { if (j !== i && c[j]!.high >= h) { ok = false; break; } }
    if (ok) out.push({ idx: i, price: h });
  }
  return out;
}

type Res = { trades: number; tpHits: number; net: number; gross: number; forced: number; forcedWin: number; noSetup: number; finalEq: number; maxDD: number };

function run(
  c: C[], startMs: number, tpPts: number, piv: number, chanWpct: number, minTouch: number,
  entryStart: number, entryEnd: number, exitHour: number, feePct: number, notional: number,
): Res {
  const f = feePct / 100;
  const pivs = pivotHighs(c, piv);
  // pivot i becomes usable only AFTER its right-confirmation bar closes: usable at openTime of bar (idx+piv).
  const r: Res = { trades: 0, tpHits: 0, net: 0, gross: 0, forced: 0, forcedWin: 0, noSetup: 0, finalEq: notional, maxDD: 0 };
  let eq = notional, peak = notional;

  // group candles by UTC day
  const days = new Map<number, C[]>();
  for (const cd of c) { if (cd.openTime < startMs) continue; const a = days.get(cd.day) ?? []; a.push(cd); days.set(cd.day, a); }

  for (const [, dayCandles] of [...days.entries()].sort((a, b) => a[0] - b[0])) {
    const win = dayCandles.filter((x) => x.hour >= entryStart && x.hour < entryEnd);
    if (win.length === 0) continue;
    const windowOpenTime = win[0]!.openTime, windowOpenPx = win[0]!.open;

    // eligible pivots: confirmed strictly before the window opens
    const overhead = pivs
      .filter((p) => c[p.idx + piv] && c[p.idx + piv]!.openTime + HALFHOUR_MS <= windowOpenTime)
      .filter((p) => p.price > windowOpenPx)
      .map((p) => p.price)
      .sort((a, b) => a - b);
    if (overhead.length === 0) { r.noSetup++; continue; }

    // nearest cluster above price: start at lowest overhead pivot, extend while within chanW
    const chanW = (chanWpct / 100) * windowOpenPx;
    const lower = overhead[0]!; let upper = lower, touches = 1;
    for (let k = 1; k < overhead.length; k++) { if (overhead[k]! - upper <= chanW) { upper = overhead[k]!; touches++; } else break; }
    if (touches < minTouch) { r.noSetup++; continue; }

    // short trigger = zone lower edge
    const trigger = lower;
    let entry: number | null = null, entryIdxInDay = -1;
    for (let k = 0; k < win.length; k++) { if (win[k]!.high >= trigger) { entry = trigger; entryIdxInDay = dayCandles.indexOf(win[k]!); break; } }
    if (entry === null) { r.noSetup++; continue; }

    const tpPx = entry - tpPts;
    let exitRet: number | null = null, hitTP = false;
    for (let k = entryIdxInDay; k < dayCandles.length; k++) {
      const cd = dayCandles[k]!;
      if (k > entryIdxInDay && cd.hour >= exitHour) { exitRet = (entry - cd.open) / entry; break; } // force close at exitHour open
      if (cd.low <= tpPx) { exitRet = tpPts / entry; hitTP = true; break; }                          // TP (short: price fell)
    }
    if (exitRet === null) { // window ran to end of day without reaching exitHour (shouldn't happen for exitHour<24) → close at last close
      const last = dayCandles[dayCandles.length - 1]!; exitRet = (entry - last.close) / entry;
    }

    const g = notional * exitRet;
    const n = notional * ((1 + exitRet) * (1 - f) * (1 - f) - 1);
    r.trades++; r.gross += g; r.net += n;
    if (hitTP) r.tpHits++; else { r.forced++; if (exitRet >= 0) r.forcedWin++; }
    // compounded equity
    eq *= (1 + exitRet) * (1 - f) * (1 - f);
    peak = Math.max(peak, eq); r.maxDD = Math.max(r.maxDD, (peak - eq) / peak);
  }
  r.finalEq = eq;
  return r;
}

async function main() {
  const [, , startA, tpA, pivA, chanA, mtA, esA, eeA, ehA, feeA, notA] = process.argv;
  const startMs = startA ? Date.parse(startA) : Date.parse('2024-01-01T00:00:00Z');
  const tpPts = Number(tpA ?? 500), piv = Number(pivA ?? 10), chanWpct = Number(chanA ?? 0.5), minTouch = Number(mtA ?? 1);
  const entryStart = Number(esA ?? 0), entryEnd = Number(eeA ?? 6), exitHour = Number(ehA ?? 16);
  const fee = Number(feeA ?? 0.05), notional = Number(notA ?? 1000);
  const endMs = Date.now(), warmStartMs = startMs - 15 * DAY_MS; // warmup for pivots

  const c = await fetchKlines(SYMBOL, INTERVAL, warmStartMs, endMs);
  const startLabel = new Date(startMs).toISOString().slice(0, 10), endLabel = new Date(endMs).toISOString().slice(0, 10);

  console.log(`\n=== BTC SHORT · Asian S/R-channel fade (M30) · ${startLabel} → ${endLabel} · fee ${fee}%/side · $${notional}/trade ===`);
  console.log(`    entry window ${String(entryStart).padStart(2, '0')}:00–${String(entryEnd).padStart(2, '0')}:00 UTC · force-close ${String(exitHour).padStart(2, '0')}:00 UTC · NO stop · candles: ${c.length}\n`);

  // Main config + a small robustness sweep over pivot period / channel width / TP / minTouch
  const configs: { piv: number; chanWpct: number; minTouch: number; tpPts: number }[] = [
    { piv, chanWpct, minTouch, tpPts },
    { piv: 5, chanWpct, minTouch, tpPts },
    { piv: 20, chanWpct, minTouch, tpPts },
    { piv, chanWpct, minTouch: 2, tpPts },
    { piv, chanWpct, minTouch, tpPts: 300 },
    { piv, chanWpct, minTouch, tpPts: 700 },
  ];

  console.log('  piv | chanW% | touch |  TP$ | trades | TP hit | TP% | forced(grn) |  GROSS $  | fees      |   NET $   | net/trd | $1k→eq | maxDD');
  for (const cfg of configs) {
    const r = run(c, startMs, cfg.tpPts, cfg.piv, cfg.chanWpct, cfg.minTouch, entryStart, entryEnd, exitHour, fee, notional);
    const tpRate = r.trades ? (r.tpHits / r.trades) * 100 : 0;
    console.log(
      `  ${String(cfg.piv).padStart(3)} | ${fmt(cfg.chanWpct, 1).padStart(6)} | ${String(cfg.minTouch).padStart(5)} | ${String(cfg.tpPts).padStart(4)} | ` +
        `${String(r.trades).padStart(6)} | ${String(r.tpHits).padStart(6)} | ${(fmt(tpRate, 0) + '%').padStart(4)} | ` +
        `${(String(r.forced) + '(' + r.forcedWin + ')').padStart(11)} | ${usd(r.gross).padStart(9)} | ${usd(-(r.gross - r.net)).padStart(9)} | ` +
        `${usd(r.net).padStart(9)} | ${usd(r.trades ? r.net / r.trades : 0).padStart(7)} | ${('$' + fmt(r.finalEq, 0)).padStart(6)} | ${fmt(r.maxDD * 100, 1)}%`,
    );
  }
  console.log('');
}
main().catch((e) => { console.error(e); process.exit(1); });
