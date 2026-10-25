/**
 * Backtest of the /trading-analysis paper strategies with the SAME signal + trade-management code
 * the live engine runs (firesAt / stepPosition from rsi-volume-strategies.ts), so a variant that
 * wins here is exactly what goes live. Compares the pre-2026-10-15 rules ("old") with the review
 * changes, one change at a time and all together, on every coin.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-paper-strategies-backtest.ts <dataDir> [symbols=BTCUSDT,ETHUSDT,SOLUSDT] [from=2024-01-01]
 *
 * <dataDir> caches Binance klines as <SYMBOL>_<tf>.csv (t,o,h,l,c,v); missing files are fetched.
 * Fee 0.05%/side. Results include no slippage / funding.
 */
import * as fs from 'fs';
import * as path from 'path';

import {
  RSI_VOLUME_STRATEGIES,
  buildContext,
  firesAt,
  levelsFor,
  stepPosition,
  type PaperCandle,
  type RsiVolumeStrategyDef,
} from '../apps/api/src/modules/strategy-paper-trades/rsi-volume-strategies';
import { PDHL_MAX_RISK_PCT, pdhlSignal } from '../apps/api/src/modules/strategy-paper-trades/pdhl-rules';

const FEE = 0.0005;
const TF_MS: Record<string, number> = { '5m': 3e5, '15m': 9e5, '1h': 36e5, '1d': 864e5 };
const WARMUP_START = Date.UTC(2023, 11, 1);

const [dataDir = 'claude-backtest/data/paper', symArg = 'BTCUSDT,ETHUSDT,SOLUSDT', fromArg = '2024-01-01'] = process.argv.slice(2);
const SYMBOLS = symArg.split(',');
const FROM = Date.parse(`${fromArg}T00:00:00Z`);

async function loadCandles(symbol: string, tf: string): Promise<PaperCandle[]> {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, `${symbol}_${tf}.csv`);
  if (!fs.existsSync(file)) {
    const rows: string[] = ['t,o,h,l,c,v'];
    let t = WARMUP_START;
    for (;;) {
      const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${tf}&startTime=${t}&limit=1000`);
      const d = (await res.json()) as unknown[][];
      if (!d.length) break;
      for (const k of d) rows.push(k.slice(0, 6).join(','));
      t = Number(d[d.length - 1]![0]) + 1;
      if (d.length < 1000) break;
    }
    rows.pop(); // in-progress candle
    fs.writeFileSync(file, rows.join('\n'));
  }
  const ms = TF_MS[tf]!;
  return fs.readFileSync(file, 'utf8').trim().split('\n').slice(1).map((line) => {
    const [t, o, h, l, c, v] = line.split(',').map(Number) as [number, number, number, number, number, number];
    return { t, closeT: t + ms - 1, open: o, high: h, low: l, close: c, volume: v };
  });
}

type Trade = { symbol: string; openedAt: number; r: number; reason: string };

const rOf = (long: boolean, entry: number, exit: number, risk: number) =>
  ((long ? exit - entry : entry - exit) - (entry + exit) * FEE) / risk;

/** RSI strategy, one trade at a time, next-bar-open entry, signal strictly after the last exit. */
function runRsi(def: RsiVolumeStrategyDef, symbol: string, ltf: PaperCandle[], h1: PaperCandle[], d1: PaperCandle[]): Trade[] {
  const ctx = buildContext(def, ltf, h1, d1);
  const out: Trade[] = [];
  let i = 60;
  while (i < ltf.length - 1) {
    if (ltf[i]!.t < FROM || !firesAt(def, ctx, i)) { i += 1; continue; }
    const entryBar = ltf[i + 1]!;
    const entry = entryBar.open;
    const { stop, takeProfit, risk } = levelsFor(def, entry);
    const pos = { direction: def.direction, entryPrice: entry, initialStopLoss: stop, stopLoss: stop, takeProfit, openedAt: entryBar.t };
    let j = i + 1;
    let done = false;
    for (; j < ltf.length; j += 1) {
      const s = stepPosition(def, pos, ltf[j]!);
      if (s.exit) {
        out.push({ symbol, openedAt: pos.openedAt, r: rOf(def.direction === 'LONG', entry, s.exit.price, risk), reason: s.exit.reason });
        done = true;
        break;
      }
      pos.stopLoss = s.stopLoss;
    }
    if (!done) break; // still open at the end of the data
    i = j + 1;
  }
  return out;
}

/** PDH/PDL on 1h — mirrors StrategyPaperTradesService (one side per day, EOD close). */
function runPdhl(symbol: string, h1: PaperCandle[], rr: number, breakeven: { atR: number; lockR: number } | undefined, minBreakPct: number, maxRiskPct = PDHL_MAX_RISK_PCT): Trade[] {
  const out: Trade[] = [];
  const day = (ms: number) => Math.floor(ms / 864e5);
  const taken = new Set<string>();
  let i = 30;
  while (i < h1.length - 1) {
    const sig = h1[i]!;
    const sg = sig.t >= FROM ? pdhlSignal(h1.slice(Math.max(0, i - 60), i + 1), minBreakPct, maxRiskPct) : null;
    const key = sg ? `${day(sig.t)}-${sg.direction}` : '';
    if (!sg || taken.has(key)) { i += 1; continue; }
    taken.add(key);
    const long = sg.direction === 'LONG';
    const entry = sig.close;
    const risk = Math.abs(entry - sg.stop);
    const pos = { direction: sg.direction, entryPrice: entry, initialStopLoss: sg.stop, stopLoss: sg.stop, takeProfit: long ? entry + rr * risk : entry - rr * risk, openedAt: sig.closeT };
    let j = i + 1;
    let exit: { price: number; reason: string } | null = null;
    for (; j < h1.length; j += 1) {
      const c = h1[j]!;
      if (day(c.t) !== day(sig.t)) { exit = { price: h1[j - 1]!.close, reason: 'EOD' }; j -= 1; break; }
      const s = stepPosition({ breakeven }, pos, c);
      if (s.exit) { exit = s.exit; break; }
      pos.stopLoss = s.stopLoss;
    }
    if (!exit) break;
    out.push({ symbol, openedAt: pos.openedAt, r: rOf(long, entry, exit.price, risk), reason: exit.reason });
    i = j + 1;
  }
  return out;
}

function summarize(trades: Trade[]) {
  const n = trades.length;
  const wins = trades.filter((t) => t.r > 0).length;
  const total = trades.reduce((s, t) => s + t.r, 0);
  let eq = 0, peak = 0, dd = 0;
  for (const t of [...trades].sort((a, b) => a.openedAt - b.openedAt)) { eq += t.r; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak); }
  const byYear: Record<string, number[]> = {};
  for (const t of trades) (byYear[new Date(t.openedAt).getUTCFullYear()] ??= []).push(t.r);
  const ys = Object.keys(byYear).sort();
  const years = ys.map((y) => `${y.slice(2)}:${byYear[y]!.reduce((s, r) => s + r, 0).toFixed(1)}R`).join(' ');
  const wrByYear = ys.map((y) => ((byYear[y]!.filter((r) => r > 0).length / byYear[y]!.length) * 100).toFixed(1)).join(' / ');
  const days = n ? (Date.now() - FROM) / 864e5 : 1;
  return { n, wr: n ? (wins / n) * 100 : 0, total, exp: n ? total / n : 0, dd, years, wrByYear, perDay: n / days };
}

const fmt = (s: ReturnType<typeof summarize>) =>
  `${String(s.n).padStart(4)} | ${s.wr.toFixed(1).padStart(5)}% | ${s.total.toFixed(1).padStart(6)}R | ${s.exp.toFixed(3).padStart(6)} | ${s.dd.toFixed(1).padStart(6)}R | ${s.years} | WR ${s.wrByYear} | ${s.perDay.toFixed(2)}/d`;

/** Rules before the 2026-10-15 review (overrides on top of the shipped defs). */
const OLD: Record<string, Partial<RsiVolumeStrategyDef>> = {
  'rsi-5m-short-1r': {},
  'rsi-5m-long-1r': {},
  'rsi-5m-long-div-1_5r': { trendFilter: undefined, maxRise24hPct: undefined },
  'rsi-15m-long-2r': { trendFilter: undefined, maxRise24hPct: undefined },
};

/** Changes proposed from the 89 live paper trades — each tried alone on top of "old". */
const ANTI_CHASE_RSI = { h1Rsi: { min: 40, max: 60 } };
const EXPERIMENTS: Record<string, [string, Partial<RsiVolumeStrategyDef>][]> = {
  'rsi-5m-short-1r': [['+ 1h trend filter', { trendFilter: true }]],
  'rsi-5m-long-1r': [
    ['+ RSI1h ≤ 60', ANTI_CHASE_RSI],
    ['+ 24h rise < 1%', { maxRise24hPct: 1 }],
    ['+ 1h trend filter', { trendFilter: true }],
    ['+ 24h rise + trend', { maxRise24hPct: 1, trendFilter: true }],
    ['+ BE @0.5R', { breakeven: { atR: 0.5, lockR: 0.1 } }],
  ],
  'rsi-5m-long-div-1_5r': [
    ['+ RSI1h ≤ 60', ANTI_CHASE_RSI],
    ['+ 24h rise < 1%', { maxRise24hPct: 1 }],
    ['+ 1h trend filter', { trendFilter: true }],
  ],
  'rsi-15m-long-2r': [
    ['+ RSI1h ≤ 60', ANTI_CHASE_RSI],
    ['+ 24h rise < 1%', { maxRise24hPct: 1 }],
    ['+ 1h trend filter', { trendFilter: true }],
    ['+ TP 1.5R', { rr: 1.5 }],
    ['+ max hold 24h', { maxHoldHours: 24 }],
  ],
};
const PDHL_BREAKEVEN = { atR: 0.7, lockR: 0.1 };

async function main() {
  const data: Record<string, Record<string, PaperCandle[]>> = {};
  for (const s of SYMBOLS) {
    data[s] = {};
    for (const tf of ['5m', '15m', '1h', '1d']) data[s]![tf] = await loadCandles(s, tf);
  }
  const json: Record<string, unknown> = {};
  const header = `variant                          | coin |    n |    WR  |  total  |  exp/R |  maxDD  | by year`;

  for (const cur of RSI_VOLUME_STRATEGIES) {
    const old = { ...cur, ...OLD[cur.id] } as RsiVolumeStrategyDef;
    const variants: [string, RsiVolumeStrategyDef][] = [
      ['old', old],
      ...(EXPERIMENTS[cur.id] ?? []).map(([name, o]): [string, RsiVolumeStrategyDef] => [name, { ...old, ...o }]),
      ['LIVE (as shipped)', cur],
    ];

    console.log(`\n=== ${cur.name}\n${header}`);
    for (const [name, def] of variants) {
      const all: Trade[] = [];
      for (const s of SYMBOLS) {
        if (name === 'LIVE (as shipped)' && def.symbols && !def.symbols.includes(s)) continue; // coin not run live
        const d = data[s]!;
        const trades = runRsi(def, s, d[def.timeframe]!, d['1h']!, d['1d']!);
        all.push(...trades);
        const sum = summarize(trades);
        console.log(`${name.padEnd(32)} | ${s.replace('USDT', '').padEnd(4)} | ${fmt(sum)}`);
        json[`${cur.id}|${name}|${s}`] = sum;
      }
      const sum = summarize(all);
      console.log(`${name.padEnd(32)} | ALL  | ${fmt(sum)}`);
      json[`${cur.id}|${name}|ALL`] = sum;
    }
  }

  console.log(`\n=== PDH/PDL 1h (TP 2R, EOD close)\n${header}`);
  // "old" = before the 2026-10-25 risk cap (no cap); the other rows add one change each to "old".
  const pdhlVariants: [string, { atR: number; lockR: number } | undefined, number, number][] = [
    ['old', undefined, 0, Infinity],
    [`+ BE @${PDHL_BREAKEVEN.atR}R`, PDHL_BREAKEVEN, 0, Infinity],
    ['+ min break 0.2%', undefined, 0.2, Infinity],
    ['+ BE + min break 0.2%', PDHL_BREAKEVEN, 0.2, Infinity],
    [`LIVE (risk ≤ ${PDHL_MAX_RISK_PCT}%)`, undefined, 0, PDHL_MAX_RISK_PCT],
  ];
  for (const [name, be, minBreak, maxRisk] of pdhlVariants) {
    const all: Trade[] = [];
    for (const s of SYMBOLS) {
      const trades = runPdhl(s, data[s]!['1h']!, 2, be, minBreak, maxRisk);
      all.push(...trades);
      const sum = summarize(trades);
      console.log(`${name.padEnd(32)} | ${s.replace('USDT', '').padEnd(4)} | ${fmt(sum)}`);
      json[`pdhl-btc|${name}|${s}`] = sum;
    }
    const sum = summarize(all);
    console.log(`${name.padEnd(32)} | ALL  | ${fmt(sum)}`);
    json[`pdhl-btc|${name}|ALL`] = sum;
  }
  fs.writeFileSync(path.join(dataDir, 'results.json'), JSON.stringify(json, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
