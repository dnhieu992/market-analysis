/**
 * QQE bull-flip (D1) win-rate vs "break the old low".
 *
 * Question this answers (user's framing):
 *   "On each QQE bull flip, how often does price rise +5% / +10% / +15% BEFORE it
 *    breaks the most recent strong swing low? A trade that breaks that low = FAILED."
 *
 * Strategy modelled:
 *   - Signal: a D1 candle CLOSES with a QQE green ▲ (`cross === 'long'`) — the exact
 *     same arrow the /bitget Setup-tab "QQE" column and the D1 Telegram alert fire on.
 *     Params mirror QQE_PARAMS: rsiPeriod 10 · smoothing 4 · qqeFactor 3.2.
 *   - Entry price = that candle's close.
 *   - "Đáy cũ" (old low) = the low of the most recent CONFIRMED swing-low pivot before
 *     entry that sits below the entry price. Pivot = a local min with `pivot` bars on
 *     each side (no lookahead: a pivot at bar p is only "known" at bar p+pivot).
 *   - Walk forward bar by bar from the next candle:
 *       · WIN@X  = intra-candle high reaches entry×(1+X%) BEFORE any candle's low
 *                  breaks the old low.
 *       · FAIL   = a candle's low breaks the old low first (or same bar as the target —
 *                  counted as FAIL, pessimistic).
 *       · UNRESOLVED = neither happened before the data ends.
 *   - Win rate @X = WIN / (WIN + FAIL). Targets are nested, so WIN@5 ≥ WIN@10 ≥ WIN@15.
 *
 * No leverage, no fees (this is a "does price get there first" hit-rate study, not a P&L
 * curve — fees don't change whether a level is touched before another).
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-qqe-d1-oldlow-winrate.ts [interval] [startDate] [pivot] [symbols?]
 *
 *   # D1, from 2023-01-01, pivot window 5, default Setup-tab coin basket
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-qqe-d1-oldlow-winrate.ts 1d 2023-01-01 5
 */
import * as https from 'https';
import { calculateQqe } from '@app/core';

const QQE = { rsiPeriod: 10, smoothing: 4, qqeFactor: 3.2 } as const;
const TARGETS = [5, 10, 15] as const;

// Default basket = the coins currently in the /bitget Setup tab (2026-09-18 snapshot).
// Override by passing a comma list as the 4th arg. Coins listed after 2023 simply
// contribute fewer signals (Binance returns data from their listing date onward).
const DEFAULT_SYMBOLS = [
  'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'AVAX', 'LINK', 'DOGE', 'LTC',
  'BCH', 'ETC', 'UNI', 'NEAR', 'APT', 'ARB', 'OP', 'SUI', 'INJ', 'TIA',
  'FIL', 'HBAR', 'AAVE', 'POL', 'PEPE', 'SHIB', 'WLD', 'FET', 'TAO', 'ONDO',
  'IOTX', 'DOT', 'ATOM',
].map((s) => `${s}USDT`);

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;

type Candle = { openTime: number; high: number; low: number; close: number; year: number };

function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(d));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

async function fetchKlines(symbol: string, interval: string, startMs: number, endMs: number): Promise<Candle[]> {
  const out: Candle[] = [];
  let cur = startMs;
  while (cur < endMs) {
    const url = `${BINANCE_HOST}?symbol=${symbol}&interval=${interval}&startTime=${cur}&endTime=${endMs}&limit=${MAX_PER_REQ}`;
    const batch = (await fetchJson(url)) as unknown[][];
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const k of batch) {
      const t = k[0] as number;
      out.push({
        openTime: t,
        high: +(k[2] as string),
        low: +(k[3] as string),
        close: +(k[4] as string),
        year: new Date(t).getUTCFullYear(),
      });
    }
    if (batch.length < MAX_PER_REQ) break;
    cur = (batch[batch.length - 1]![0] as number) + 1;
  }
  return out;
}

const fmt = (n: number, d = 1) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const pctOf = (num: number, den: number) => (den > 0 ? (num / den) * 100 : 0);

/** Confirmed swing-low pivots: low[i] is a local min over [i-left, i+right] (ties ok). */
function pivotLowFlags(candles: Candle[], left: number, right: number): boolean[] {
  const n = candles.length;
  const flags = new Array<boolean>(n).fill(false);
  for (let i = left; i < n - right; i++) {
    const lo = candles[i]!.low;
    let ok = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (candles[j]!.low < lo) {
        ok = false;
        break;
      }
    }
    flags[i] = ok;
  }
  return flags;
}

/** Confirmed swing-high pivots: high[i] is a local max over [i-left, i+right] (ties ok). */
function pivotHighFlags(candles: Candle[], left: number, right: number): boolean[] {
  const n = candles.length;
  const flags = new Array<boolean>(n).fill(false);
  for (let i = left; i < n - right; i++) {
    const hi = candles[i]!.high;
    let ok = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (candles[j]!.high > hi) {
        ok = false;
        break;
      }
    }
    flags[i] = ok;
  }
  return flags;
}

type Side = 'long' | 'short';

type Outcome = 'win' | 'fail' | 'unresolved';
type Signal = {
  symbol: string;
  entryTime: number;
  year: number;
  entry: number;
  guard: number; // long: the old low (fail if broken down); short: the old high (fail if broken up)
  // per-target outcome
  target: Record<number, Outcome>;
  barsToFail: number | null;
};

function evaluateSymbol(symbol: string, candles: Candle[], left: number, right: number, side: Side): Signal[] {
  if (candles.length < 60) return [];
  const closes = candles.map((c) => c.close);
  const { cross } = calculateQqe(closes, QQE.rsiPeriod, QQE.smoothing, QQE.qqeFactor);
  const pivots = side === 'long' ? pivotLowFlags(candles, left, right) : pivotHighFlags(candles, left, right);
  const signals: Signal[] = [];

  for (let e = 0; e < candles.length; e++) {
    if (cross[e] !== side) continue;
    const entry = candles[e]!.close;

    // Most recent CONFIRMED pivot (p + right <= e) on the guard side of the entry:
    //   long  → nearest pivot LOW below entry  (fail = price breaks it downward)
    //   short → nearest pivot HIGH above entry (fail = price breaks it upward)
    let guard: number | null = null;
    for (let p = e - right; p >= 0; p--) {
      if (!pivots[p]) continue;
      if (side === 'long' && candles[p]!.low < entry) {
        guard = candles[p]!.low;
        break;
      }
      if (side === 'short' && candles[p]!.high > entry) {
        guard = candles[p]!.high;
        break;
      }
    }
    if (guard == null) continue; // no definable old low/high — skip

    const target: Record<number, Outcome> = {};
    for (const X of TARGETS) target[X] = 'unresolved';
    let barsToFail: number | null = null;

    // Walk forward from the next candle.
    const remaining = new Set<number>(TARGETS);
    for (let j = e + 1; j < candles.length && remaining.size > 0; j++) {
      const c = candles[j]!;
      // FAIL when the guard breaks: long = low ≤ old low; short = high ≥ old high.
      const broke = side === 'long' ? c.low <= guard : c.high >= guard;
      for (const X of [...remaining]) {
        // WIN when the favorable target is touched: long = high ≥ +X%; short = low ≤ −X%.
        const hitTarget = side === 'long' ? c.high >= entry * (1 + X / 100) : c.low <= entry * (1 - X / 100);
        if (hitTarget && !broke) {
          target[X] = 'win';
          remaining.delete(X);
        } else if (broke) {
          // Break of the guard (same bar as target ⇒ pessimistic FAIL).
          target[X] = 'fail';
          remaining.delete(X);
        }
      }
      if (broke && barsToFail == null) barsToFail = j - e;
      if (broke) break; // once the guard breaks, every unresolved target is a FAIL
    }

    signals.push({
      symbol,
      entryTime: candles[e]!.openTime,
      year: candles[e]!.year,
      entry,
      guard,
      target,
      barsToFail,
    });
  }
  return signals;
}

type Tally = { win: number; fail: number; unresolved: number };
function tallyFor(signals: Signal[], X: number): Tally {
  const t: Tally = { win: 0, fail: 0, unresolved: 0 };
  for (const s of signals) t[s.target[X]!]++;
  return t;
}

function printTargetTable(title: string, signals: Signal[], sign: string) {
  console.log(`\n${title}`);
  console.log('  target |  win  | fail  | undec | win rate (win/(win+fail))');
  for (const X of TARGETS) {
    const t = tallyFor(signals, X);
    const decided = t.win + t.fail;
    console.log(
      `   ${sign}${String(X).padStart(2)}%  | ${String(t.win).padStart(5)} | ${String(t.fail).padStart(5)} | ` +
        `${String(t.unresolved).padStart(5)} | ${(fmt(pctOf(t.win, decided)) + '%').padStart(7)}   ` +
        `(of all signals: ${fmt(pctOf(t.win, signals.length))}%)`,
    );
  }
}

async function main() {
  const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
  const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const side: Side = flags.includes('--short') ? 'short' : 'long';
  const interval = argv[0] ?? '1d';
  const startDate = argv[1] ?? '2023-01-01';
  const pivot = Number(argv[2] ?? 5);
  const symbols = argv[3] ? argv[3].split(',').map((s) => s.trim().toUpperCase()) : DEFAULT_SYMBOLS;

  const endMs = Date.now();
  const startMs = Date.parse(`${startDate}T00:00:00Z`);

  const flipName = side === 'long' ? 'bull-flip ▲' : 'bear-flip ▼';
  const guardName = side === 'long' ? 'break-of-old-low' : 'break-of-old-high';
  const dir = side === 'long' ? 'rise +' : 'drop −';
  console.log(`\nQQE ${flipName} (${interval}) win-rate vs ${guardName}  [side: ${side.toUpperCase()}, win = ${dir}X%]`);
  console.log(`  QQE ${QQE.rsiPeriod}/${QQE.smoothing}/${QQE.qqeFactor} · from ${startDate} → now · pivot window ${pivot}×${pivot} · ${symbols.length} coins`);
  console.log(`  Fetching klines…`);

  const all: Signal[] = [];
  const perCoin: { symbol: string; n: number }[] = [];
  for (const sym of symbols) {
    try {
      const candles = await fetchKlines(sym, interval, startMs, endMs);
      const sigs = evaluateSymbol(sym, candles, pivot, pivot, side);
      all.push(...sigs);
      perCoin.push({ symbol: sym, n: sigs.length });
    } catch (e) {
      console.log(`  ! ${sym} skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const guardWord = side === 'long' ? 'old low' : 'old high';
  const sign = side === 'long' ? '+' : '−';
  console.log(`\n${'='.repeat(70)}`);
  console.log(`AGGREGATE — ${all.length} ${flipName} signals across ${symbols.length} coins`);
  console.log('='.repeat(70));
  printTargetTable('ALL COINS · ALL YEARS', all, sign);

  // Hard-fail rate: broke the guard before even the first target.
  const t5 = tallyFor(all, 5);
  console.log(
    `\n  ► Broke the ${guardWord} before ${sign}5% (hard fail): ${t5.fail} / ${all.length} = ${fmt(pctOf(t5.fail, all.length))}%`,
  );
  const failBars = all.map((s) => s.barsToFail).filter((b): b is number => b != null).sort((a, b) => a - b);
  if (failBars.length) {
    const median = failBars[Math.floor(failBars.length / 2)]!;
    console.log(`  ► Of the ${failBars.length} signals that ever broke the ${guardWord}, median time to break: ${median} bars`);
  }

  // Per year (by entry year).
  console.log(`\n--- PER YEAR (win rate = win/(win+fail)) ---`);
  console.log(`  year |  n  | ${sign}5% win | ${sign}10% win | ${sign}15% win`);
  for (const y of [...new Set(all.map((s) => s.year))].sort()) {
    const ys = all.filter((s) => s.year === y);
    const cells = TARGETS.map((X) => {
      const t = tallyFor(ys, X);
      return (fmt(pctOf(t.win, t.win + t.fail)) + '%').padStart(7);
    });
    console.log(`  ${y} | ${String(ys.length).padStart(3)} | ${cells[0]!.padStart(7)} | ${cells[1]!.padStart(8)} | ${cells[2]!.padStart(8)}`);
  }

  // Per coin (compact).
  console.log(`\n--- PER COIN (n signals · +5% / +10% / +15% win rate) ---`);
  for (const { symbol } of perCoin.sort((a, b) => a.symbol.localeCompare(b.symbol))) {
    const cs = all.filter((s) => s.symbol === symbol);
    if (!cs.length) {
      console.log(`  ${symbol.padEnd(10)} | 0 signals`);
      continue;
    }
    const cells = TARGETS.map((X) => {
      const t = tallyFor(cs, X);
      return (fmt(pctOf(t.win, t.win + t.fail), 0) + '%').padStart(4);
    });
    console.log(`  ${symbol.padEnd(10)} | ${String(cs.length).padStart(3)} | ${cells.join(' / ')}`);
  }

  // Pivot sensitivity note (recompute aggregate +10% for a few windows on BTC-sized cost is high;
  // instead just remind the reader the number moves with the pivot window).
  console.log(`\nNote: "${guardWord}" strength = pivot window ${pivot}. A larger window = deeper/rarer levels`);
  console.log(`      (harder to break → higher win rate); a smaller window = shallower levels.`);
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
