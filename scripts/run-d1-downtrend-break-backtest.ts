/**
 * "Khi D1 phá trend giảm thì bao nhiêu lần giá tăng > 20%?"
 *
 * Scans BTCUSDT 1d candles from a given start year and counts every DOWNTREND BREAK,
 * then measures how far price ran afterwards.
 *
 * "Phá trend giảm" is ambiguous, so three independent definitions are scanned:
 *
 *   A) UTBot flip      — the repo's own trend definition (Wilder ATR trailing stop,
 *                        atrPeriod 10). Event = trend flips bear -> bull on candle CLOSE.
 *   B) Swing-high break— classic structure break. After a run of LOWER pivot highs plus a
 *                        lower low, event = D1 CLOSES above the most recent pivot high.
 *   C) Trendline break — the literal reading. Draw the descending line through the last two
 *                        lower pivot highs; event = first D1 CLOSE above that line.
 *
 * Every event is qualified by a real preceding downtrend:
 *   - the bear leg lasted >= minDownDays daily candles, AND
 *   - price fell >= minDeclinePct from the leg's highest high to its lowest low.
 * Unqualified (noise) events are counted separately so both numbers are visible.
 *
 * For each event we measure, from the BREAK CANDLE'S CLOSE:
 *   - MFE until invalidation (structure fails / trend flips back down) -> did it hit +X%?
 *   - MFE within fixed 30 / 60 / 90 day horizons, ignoring invalidation.
 *   - Return at invalidation (what a "hold until the break fails" trade would have made).
 *
 * No fees are applied: this is a statistical scan of price behaviour, not a strategy P&L.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-d1-downtrend-break-backtest.ts [symbol] [startYear] [targetPct] [minDownDays] [minDeclinePct]
 *   e.g. ... run-d1-downtrend-break-backtest.ts BTCUSDT 2020 20 15 10
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const ATR_PERIOD = 10;
const PIVOT_WING = 3; // fractal: 3 bars left and right

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

function wilderAtr(c: Candle[], period: number): number[] {
  const n = c.length;
  const tr = c.map((x, i) =>
    i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1]!.close), Math.abs(x.low - c[i - 1]!.close)),
  );
  const atr = new Array(n).fill(0);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i]!;
  atr[period - 1] = sum / period;
  for (let i = period; i < n; i++) atr[i] = (atr[i - 1]! * (period - 1) + tr[i]!) / period;
  return atr;
}

/** Same UTBot stop formula as scripts/run-flip-backtest.ts. */
function utBotStops(c: Candle[], period: number, keyValue: number): number[] {
  const atr = wilderAtr(c, period);
  const stop = new Array(c.length).fill(0);
  for (let i = 1; i < c.length; i++) {
    const nLoss = keyValue * atr[i]!;
    const close = c[i]!.close;
    const prevC = c[i - 1]!.close;
    const prev = stop[i - 1]!;
    if (close > prev && prevC > prev) stop[i] = Math.max(prev, close - nLoss);
    else if (close < prev && prevC < prev) stop[i] = Math.min(prev, close + nLoss);
    else if (close > prev) stop[i] = close - nLoss;
    else stop[i] = close + nLoss;
  }
  return stop;
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtUsd(n: number): string {
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

type Pivot = { idx: number; price: number };

/** Confirmed fractal pivot highs (strictly highest high in the +/- wing window). */
function pivotHighs(c: Candle[], wing: number): Pivot[] {
  const out: Pivot[] = [];
  for (let i = wing; i < c.length - wing; i++) {
    const h = c[i]!.high;
    let ok = true;
    for (let j = i - wing; j <= i + wing; j++) {
      if (j !== i && c[j]!.high >= h) {
        ok = false;
        break;
      }
    }
    if (ok) out.push({ idx: i, price: h });
  }
  return out;
}

type BreakEvent = {
  idx: number;
  date: Date;
  entry: number;
  downDays: number;
  declinePct: number;
  qualified: boolean;
  /** Index at which the break is considered failed (structure/trend invalidated). */
  invalidIdx: number | null;
};

type Measured = BreakEvent & {
  heldDays: number;
  mfeHeldPct: number;
  hitTargetHeld: boolean;
  daysToTarget: number | null;
  exitPct: number;
  mfe30: number;
  mfe60: number;
  mfe90: number;
};

/**
 * Measure a break event: max favourable excursion while the break is still valid,
 * plus unconditional 30/60/90d horizons.
 */
function measure(c: Candle[], ev: BreakEvent, targetPct: number): Measured {
  const entry = ev.entry;
  const end = ev.invalidIdx ?? c.length - 1;

  let mfeHeld = 0;
  let daysToTarget: number | null = null;
  for (let i = ev.idx + 1; i <= end; i++) {
    const g = ((c[i]!.high - entry) / entry) * 100;
    if (g > mfeHeld) mfeHeld = g;
    if (daysToTarget === null && g >= targetPct) daysToTarget = i - ev.idx;
  }

  const horizonMfe = (days: number): number => {
    let m = 0;
    const last = Math.min(c.length - 1, ev.idx + days);
    for (let i = ev.idx + 1; i <= last; i++) {
      const g = ((c[i]!.high - entry) / entry) * 100;
      if (g > m) m = g;
    }
    return m;
  };

  const exitClose = c[end]!.close;
  return {
    ...ev,
    heldDays: end - ev.idx,
    mfeHeldPct: mfeHeld,
    hitTargetHeld: mfeHeld >= targetPct,
    daysToTarget,
    exitPct: ((exitClose - entry) / entry) * 100,
    mfe30: horizonMfe(30),
    mfe60: horizonMfe(60),
    mfe90: horizonMfe(90),
  };
}

/** Decline stats for the bear leg spanning [from..to]. */
function legStats(c: Candle[], from: number, to: number): { downDays: number; declinePct: number } {
  let hi = -Infinity;
  let hiIdx = from;
  for (let i = from; i <= to; i++) {
    if (c[i]!.high > hi) {
      hi = c[i]!.high;
      hiIdx = i;
    }
  }
  let lo = Infinity;
  for (let i = hiIdx; i <= to; i++) lo = Math.min(lo, c[i]!.low);
  return { downDays: to - from, declinePct: hi > 0 ? ((hi - lo) / hi) * 100 : 0 };
}

// ---------------------------------------------------------------- method A: UTBot flip

function utbotBreaks(c: Candle[], keyValue: number, minDownDays: number, minDeclinePct: number): BreakEvent[] {
  const stop = utBotStops(c, ATR_PERIOD, keyValue);
  const trend: ('bull' | 'bear' | null)[] = c.map((x, i) => (i < ATR_PERIOD || stop[i] === 0 ? null : x.close > stop[i]! ? 'bull' : 'bear'));

  const events: BreakEvent[] = [];
  let legStart = ATR_PERIOD; // index where the current bear leg began
  for (let i = ATR_PERIOD + 1; i < c.length; i++) {
    const prev = trend[i - 1];
    const cur = trend[i];
    if (prev === null || cur === null || cur === prev) continue;

    if (cur === 'bull') {
      // bear -> bull : the downtrend break
      const { downDays, declinePct } = legStats(c, legStart, i);
      // the break is "alive" until the trend flips back to bear
      let invalidIdx: number | null = null;
      for (let j = i + 1; j < c.length; j++) {
        if (trend[j] === 'bear') {
          invalidIdx = j;
          break;
        }
      }
      events.push({
        idx: i,
        date: c[i]!.openTime,
        entry: c[i]!.close,
        downDays,
        declinePct,
        qualified: downDays >= minDownDays && declinePct >= minDeclinePct,
        invalidIdx,
      });
    } else {
      legStart = i; // bull -> bear : a new downtrend leg starts here
    }
  }
  return events;
}

// -------------------------------------------------- method B: break of the last pivot high

function swingHighBreaks(c: Candle[], minDownDays: number, minDeclinePct: number): BreakEvent[] {
  const pivots = pivotHighs(c, PIVOT_WING);
  const events: BreakEvent[] = [];
  let armed = false;
  let lastPivotUsed = -1;

  for (let p = 1; p < pivots.length; p++) {
    const prevP = pivots[p - 1]!;
    const curP = pivots[p]!;
    if (curP.price >= prevP.price) {
      armed = false;
      continue; // not a lower high -> no downtrend structure
    }
    armed = true;
    if (curP.idx === lastPivotUsed) continue;

    // The pivot is only known PIVOT_WING bars after it printed.
    const confirmIdx = curP.idx + PIVOT_WING;
    // Require a lower low after the pivot before we accept a "break".
    let sawLowerLow = false;
    let swingLow = Infinity;
    let swingLowIdx = confirmIdx;

    for (let i = confirmIdx + 1; i < c.length; i++) {
      if (c[i]!.low < swingLow) {
        swingLow = c[i]!.low;
        swingLowIdx = i;
        sawLowerLow = true;
      }
      // a new pivot high forming above invalidates this level as "the" resistance
      const nextP = pivots[p + 1];
      if (nextP && i > nextP.idx + PIVOT_WING) break;

      if (armed && sawLowerLow && c[i]!.close > curP.price) {
        const { downDays, declinePct } = legStats(c, prevP.idx, i);
        // invalid once price closes back below the swing low that preceded the break
        let invalidIdx: number | null = null;
        for (let j = i + 1; j < c.length; j++) {
          if (c[j]!.close < swingLow) {
            invalidIdx = j;
            break;
          }
        }
        events.push({
          idx: i,
          date: c[i]!.openTime,
          entry: c[i]!.close,
          downDays,
          declinePct,
          qualified: downDays >= minDownDays && declinePct >= minDeclinePct,
          invalidIdx,
        });
        lastPivotUsed = curP.idx;
        void swingLowIdx;
        break;
      }
    }
  }

  // de-duplicate: keep one event per break bar
  const seen = new Set<number>();
  return events.filter((e) => (seen.has(e.idx) ? false : (seen.add(e.idx), true)));
}

// ------------------------------------- method C: break of the descending trendline (2 highs)

function trendlineBreaks(c: Candle[], minDownDays: number, minDeclinePct: number): BreakEvent[] {
  const pivots = pivotHighs(c, PIVOT_WING);
  const events: BreakEvent[] = [];

  for (let p = 1; p < pivots.length; p++) {
    const a = pivots[p - 1]!;
    const b = pivots[p]!;
    if (b.price >= a.price) continue; // line must slope down

    const slope = (b.price - a.price) / (b.idx - a.idx);
    const lineAt = (i: number) => a.price + slope * (i - a.idx);

    const startIdx = b.idx + PIVOT_WING + 1; // line usable only after pivot b is confirmed
    const nextP = pivots[p + 1];
    const stopIdx = nextP ? nextP.idx + PIVOT_WING : c.length - 1; // line retires when a newer pivot pair exists

    let swingLow = Infinity;
    for (let i = startIdx; i <= Math.min(stopIdx, c.length - 1); i++) {
      swingLow = Math.min(swingLow, c[i]!.low);
      const line = lineAt(i);
      if (line <= 0) break;
      if (c[i]!.close > line && c[i - 1]!.close <= lineAt(i - 1)) {
        const { downDays, declinePct } = legStats(c, a.idx, i);
        let invalidIdx: number | null = null;
        for (let j = i + 1; j < c.length; j++) {
          if (c[j]!.close < swingLow) {
            invalidIdx = j;
            break;
          }
        }
        events.push({
          idx: i,
          date: c[i]!.openTime,
          entry: c[i]!.close,
          downDays,
          declinePct,
          qualified: downDays >= minDownDays && declinePct >= minDeclinePct,
          invalidIdx,
        });
        break; // one break per line
      }
    }
  }

  const seen = new Set<number>();
  return events.filter((e) => (seen.has(e.idx) ? false : (seen.add(e.idx), true)));
}

// ---------------------------------------------------------------------------- reporting

function summarize(label: string, rows: Measured[], targetPct: number): void {
  if (rows.length === 0) {
    console.log(`${label.padEnd(34)} no events`);
    return;
  }
  const hit = rows.filter((r) => r.hitTargetHeld).length;
  const h30 = rows.filter((r) => r.mfe30 >= targetPct).length;
  const h60 = rows.filter((r) => r.mfe60 >= targetPct).length;
  const h90 = rows.filter((r) => r.mfe90 >= targetPct).length;
  const avgMfe = rows.reduce((s, r) => s + r.mfeHeldPct, 0) / rows.length;
  const medMfe = [...rows].sort((a, b) => a.mfeHeldPct - b.mfeHeldPct)[Math.floor(rows.length / 2)]!.mfeHeldPct;
  const avgExit = rows.reduce((s, r) => s + r.exitPct, 0) / rows.length;
  const winners = rows.filter((r) => r.exitPct > 0).length;

  console.log(
    `${label.padEnd(34)} ${String(rows.length).padStart(3)}  ` +
      `${`${hit} (${((hit / rows.length) * 100).toFixed(0)}%)`.padStart(11)}  ` +
      `${`${h30} (${((h30 / rows.length) * 100).toFixed(0)}%)`.padStart(10)}  ` +
      `${`${h60} (${((h60 / rows.length) * 100).toFixed(0)}%)`.padStart(10)}  ` +
      `${`${h90} (${((h90 / rows.length) * 100).toFixed(0)}%)`.padStart(10)}  ` +
      `${avgMfe.toFixed(1).padStart(7)}%  ${medMfe.toFixed(1).padStart(7)}%  ` +
      `${avgExit.toFixed(1).padStart(7)}%  ${`${winners}/${rows.length}`.padStart(7)}`,
  );
}

function printEvents(rows: Measured[], targetPct: number): void {
  console.log('  date         entry        down(d)  decline   MFE-held   d->+' + targetPct + '%   held(d)   exit%    MFE90');
  for (const r of rows) {
    console.log(
      `  ${fmtDate(r.date)}  ${fmtUsd(r.entry).padStart(9)}  ${String(r.downDays).padStart(6)}  ` +
        `${r.declinePct.toFixed(1).padStart(6)}%  ${r.mfeHeldPct.toFixed(1).padStart(8)}%  ` +
        `${(r.daysToTarget === null ? '-' : String(r.daysToTarget)).padStart(8)}  ` +
        `${String(r.heldDays).padStart(7)}  ${r.exitPct.toFixed(1).padStart(6)}%  ${r.mfe90.toFixed(1).padStart(7)}%` +
        (r.hitTargetHeld ? '  ✓' : ''),
    );
  }
}

async function main() {
  const symbol = process.argv[2] ?? 'BTCUSDT';
  const startYear = parseInt(process.argv[3] ?? '2020', 10);
  const targetPct = parseFloat(process.argv[4] ?? '20');
  const minDownDays = parseInt(process.argv[5] ?? '15', 10);
  const minDeclinePct = parseFloat(process.argv[6] ?? '10');

  // Fetch from a year earlier so ATR / pivots are warm at the scan start.
  const fetchStart = Date.UTC(startYear - 1, 0, 1);
  const scanStart = Date.UTC(startYear, 0, 1);
  const end = Date.now();

  console.log(`Fetching ${symbol} 1d candles ...`);
  const all = await fetchKlines(symbol, '1d', fetchStart, end);
  console.log(
    `Got ${all.length} daily candles (${fmtDate(all[0]!.openTime)} -> ${fmtDate(all[all.length - 1]!.openTime)})\n`,
  );

  console.log(`Scan window     : ${fmtDate(new Date(scanStart))} -> ${fmtDate(all[all.length - 1]!.openTime)}`);
  console.log(`Target          : +${targetPct}% from the break candle's close`);
  console.log(`Qualified break : preceding downtrend >= ${minDownDays} days AND >= ${minDeclinePct}% decline\n`);

  const inWindow = (e: BreakEvent) => e.date.getTime() >= scanStart;

  type Set = { label: string; events: BreakEvent[] };
  const sets: Set[] = [
    { label: 'A. UTBot flip kv=1', events: utbotBreaks(all, 1, minDownDays, minDeclinePct) },
    { label: 'A. UTBot flip kv=2', events: utbotBreaks(all, 2, minDownDays, minDeclinePct) },
    { label: 'A. UTBot flip kv=3', events: utbotBreaks(all, 3, minDownDays, minDeclinePct) },
    { label: 'B. Swing-high break', events: swingHighBreaks(all, minDownDays, minDeclinePct) },
    { label: 'C. Trendline break', events: trendlineBreaks(all, minDownDays, minDeclinePct) },
  ];

  console.log('=== ALL breaks (no downtrend quality filter) ===');
  console.log(
    'method                              n   hit+' +
      targetPct +
      '%*     <=30d       <=60d       <=90d   avgMFE   medMFE  avgExit     win',
  );
  const measuredAll = new Map<string, Measured[]>();
  for (const s of sets) {
    const rows = s.events.filter(inWindow).map((e) => measure(all, e, targetPct));
    measuredAll.set(s.label, rows);
    summarize(s.label, rows, targetPct);
  }
  console.log('* hit = MFE reached the target BEFORE the break was invalidated (trend flipped / swing low lost)\n');

  console.log(`=== QUALIFIED breaks only (downtrend >= ${minDownDays}d and >= ${minDeclinePct}%) ===`);
  console.log(
    'method                              n   hit+' +
      targetPct +
      '%*     <=30d       <=60d       <=90d   avgMFE   medMFE  avgExit     win',
  );
  const measuredQual = new Map<string, Measured[]>();
  for (const s of sets) {
    const rows = s.events.filter((e) => inWindow(e) && e.qualified).map((e) => measure(all, e, targetPct));
    measuredQual.set(s.label, rows);
    summarize(s.label, rows, targetPct);
  }

  for (const s of sets) {
    const rows = measuredQual.get(s.label)!;
    if (rows.length === 0) continue;
    console.log(`\n--- ${s.label}: qualified events (${rows.filter((r) => r.hitTargetHeld).length}/${rows.length} hit +${targetPct}%) ---`);
    printEvents(rows, targetPct);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
