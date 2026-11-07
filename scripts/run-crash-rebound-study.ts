/**
 * Event study: after a market-wide crash day, do the /tracking-coins alts rebound +10–15%?
 *
 * Crash day (daily close, UTC) — three definitions, events closer than COOLDOWN days merged:
 *   btc5    : BTC 1d return ≤ −5%
 *   alt7    : median alt 1d return ≤ −7%
 *   alt15x3 : median alt 3d return ≤ −15%
 * Entry = every alt's close on the crash day. For each (event, alt):
 *   - max gain within 3/7/14 days (highs after the entry day)
 *   - first touch: +X% target vs −10% further drop (same candle touching both = loss, conservative)
 *   - close-to-close return after 7 / 14 days
 * Baseline = the same metrics on EVERY day (unconditional), so a hit rate is only meaningful vs it.
 * Trade sim per event: equal-weight basket, each coin TP +X%, time-stop 14d, no SL, fee 0.05%/side.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-crash-rebound-study.ts [dataDir=claude-backtest/data/crash-rebound] [from=2022-01-01] [mode=events|sweep]
 *
 * mode=sweep: drop-threshold grid over 3d / 7d / 30d windows, measured two ways —
 *   market = median alt drop over the window (event = all alts that day),
 *   coin   = the coin's own drop over the window (event per coin).
 *   Close-to-close drop, events re-arm after COOLDOWN days without a trigger.
 * Coin list = the current /tracking-coins watchlist (DB), so results carry survivorship bias.
 */
import * as fs from 'fs';
import * as path from 'path';

import { prisma } from '@app/db';

const FEE = 0.0005;
const DAY = 864e5;
const COOLDOWN = 5;
const [dataDir = 'claude-backtest/data/crash-rebound', fromArg = '2022-01-01', mode = 'events'] = process.argv.slice(2);
const FROM = Date.parse(`${fromArg}T00:00:00Z`);
const NON_ALT = new Set(['BTC', 'ETH', 'USDC', 'FDUSD', '1000SHIB']);

type C = { t: number; o: number; h: number; l: number; c: number };

async function load(symbol: string): Promise<C[]> {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, `${symbol}_1d.csv`);
  if (!fs.existsSync(file)) {
    const rows = ['t,o,h,l,c'];
    let t = FROM - 220 * DAY; // MA200 warm-up for the regime split
    for (;;) {
      const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&startTime=${t}&limit=1000`);
      if (!res.ok) break;
      const d = (await res.json()) as unknown[][];
      if (!d.length) break;
      for (const k of d) rows.push(k.slice(0, 5).join(','));
      t = Number(d[d.length - 1]![0]) + 1;
      if (d.length < 1000) break;
    }
    if (rows.length > 1) rows.pop(); // in-progress candle
    fs.writeFileSync(file, rows.join('\n'));
  }
  return fs.readFileSync(file, 'utf8').trim().split('\n').slice(1).filter(Boolean).map((line) => {
    const [t, o, h, l, c] = line.split(',').map(Number) as [number, number, number, number, number];
    return { t, o, h, l, c };
  });
}

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '—');

type Outcome = {
  max3: number; max7: number; max14: number;
  ret7: number; ret14: number;
  /** first touch within 14d: 'win' (target first) | 'loss' (−10% first) | 'none' */
  first10: 'win' | 'loss' | 'none'; first15: 'win' | 'loss' | 'none';
  hit10in7: boolean; hit15in7: boolean; hit10in14: boolean; hit15in14: boolean;
  /** basket sim: TP +10% / +15% else exit at day-14 close, net of fees */
  sim10: number; sim15: number;
};

function outcome(series: C[], i: number): Outcome | null {
  if (i + 14 >= series.length) return null;
  const entry = series[i]!.c;
  const fwd = series.slice(i + 1, i + 15);
  const maxIn = (n: number) => Math.max(...fwd.slice(0, n).map((x) => x.h)) / entry - 1;
  const first = (tp: number): 'win' | 'loss' | 'none' => {
    for (const x of fwd) {
      const down = x.l <= entry * 0.9;
      const up = x.h >= entry * (1 + tp);
      if (down) return 'loss';
      if (up) return 'win';
    }
    return 'none';
  };
  const sim = (tp: number) => {
    for (const x of fwd) if (x.h >= entry * (1 + tp)) return (1 + tp) * (1 - FEE) / (1 + FEE) - 1;
    return (fwd[13]!.c / entry) * (1 - FEE) / (1 + FEE) - 1;
  };
  const max7 = maxIn(7), max14 = maxIn(14);
  return {
    max3: maxIn(3), max7, max14,
    ret7: fwd[6]!.c / entry - 1, ret14: fwd[13]!.c / entry - 1,
    first10: first(0.10), first15: first(0.15),
    hit10in7: max7 >= 0.10, hit15in7: max7 >= 0.15, hit10in14: max14 >= 0.10, hit15in14: max14 >= 0.15,
    sim10: sim(0.10), sim15: sim(0.15),
  };
}

function summarize(label: string, os: Outcome[], events?: number) {
  const n = os.length;
  const rate = (f: (o: Outcome) => boolean) => pct(os.filter(f).length / n);
  return {
    label,
    events: events ?? '',
    samples: n,
    'max7 med': pct(median(os.map((o) => o.max7))),
    '+10% ≤7d': rate((o) => o.hit10in7),
    '+15% ≤7d': rate((o) => o.hit15in7),
    '+10% ≤14d': rate((o) => o.hit10in14),
    '+15% ≤14d': rate((o) => o.hit15in14),
    '+10 before −10': rate((o) => o.first10 === 'win'),
    '+15 before −10': rate((o) => o.first15 === 'win'),
    'ret7 med': pct(median(os.map((o) => o.ret7))),
    'sim TP10 avg': pct(os.reduce((a, o) => a + o.sim10, 0) / n),
    'sim TP15 avg': pct(os.reduce((a, o) => a + o.sim15, 0) / n),
  };
}

async function main() {
  const coins = (await prisma.trackingCoin.findMany({ select: { symbol: true } })).map((c) => c.symbol.toUpperCase());
  const alts = coins.filter((s) => !NON_ALT.has(s));
  const btc = await load('BTCUSDT');
  const data = new Map<string, C[]>();
  for (const s of alts) {
    const d = await load(`${s}USDT`);
    if (d.length > 30) data.set(s, d);
  }
  console.log(`alts with data: ${data.size}/${alts.length}`);

  // Index every series by candle open time.
  const idx = new Map<string, Map<number, number>>();
  for (const [s, d] of data) idx.set(s, new Map(d.map((x, i) => [x.t, i])));
  const btcIdx = new Map(btc.map((x, i) => [x.t, i]));

  const days = btc.map((x) => x.t).filter((t) => t >= FROM);
  const altRet = (t: number, back: number) => {
    const rs: number[] = [];
    for (const [s, d] of data) {
      const i = idx.get(s)!.get(t);
      if (i == null || i < back + 30) continue; // skip the first month after listing
      rs.push(d[i]!.c / d[i - back]!.c - 1);
    }
    return rs.length >= 20 ? median(rs) : NaN;
  };
  const regimeOf = (t: number) => {
    const i = btcIdx.get(t)!;
    if (i < 200) return 'n/a';
    const ma = btc.slice(i - 199, i + 1).reduce((a, x) => a + x.c, 0) / 200;
    return btc[i]!.c >= ma ? 'bull' : 'bear';
  };

  const defs: Record<string, (t: number) => boolean> = {
    btc5: (t) => { const i = btcIdx.get(t)!; return btc[i]!.c / btc[i - 1]!.c - 1 <= -0.05; },
    alt7: (t) => altRet(t, 1) <= -0.07,
    alt15x3: (t) => altRet(t, 3) <= -0.15,
  };

  if (mode === 'sweep') {
    const grid: Record<number, number[]> = {
      3: [-0.05, -0.08, -0.10, -0.12, -0.15, -0.20, -0.25, -0.30],
      7: [-0.10, -0.15, -0.20, -0.25, -0.30, -0.35, -0.40],
      30: [-0.15, -0.20, -0.25, -0.30, -0.35, -0.40, -0.50, -0.60],
    };
    const out: ReturnType<typeof summarize>[] = [];
    // Baseline once (every coin, every day) for reference.
    const base: Outcome[] = [];
    for (const [, d] of data) for (let i = 30; i < d.length; i++) if (d[i]!.t >= FROM) { const o = outcome(d, i); if (o) base.push(o); }
    out.push(summarize('BASELINE every day', base));
    for (const [wStr, ths] of Object.entries(grid)) {
      const w = Number(wStr);
      for (const th of ths) {
        // market: median alt w-day drop ≤ th
        const mOs: Outcome[] = [];
        let mEv = 0, last = -Infinity;
        for (const t of days) {
          if (!(altRet(t, w) <= th)) continue;
          if ((t - last) / DAY < COOLDOWN) { last = t; continue; }
          last = t; mEv++;
          for (const [sym, d] of data) {
            const i = idx.get(sym)!.get(t);
            if (i == null || i < 30) continue;
            const o = outcome(d, i);
            if (o) mOs.push(o);
          }
        }
        if (mOs.length) out.push(summarize(`market ${w}d ≤ ${th * 100}%`, mOs, mEv));
        // coin: own w-day drop ≤ th
        const cOs: Outcome[] = [];
        let cEv = 0;
        for (const [, d] of data) {
          let lastC = -Infinity;
          for (let i = Math.max(30, w); i < d.length; i++) {
            if (d[i]!.t < FROM) continue;
            if (!(d[i]!.c / d[i - w]!.c - 1 <= th)) continue;
            if (i - lastC < COOLDOWN) { lastC = i; continue; }
            lastC = i;
            const o = outcome(d, i);
            if (o) { cOs.push(o); cEv++; }
          }
        }
        if (cOs.length) out.push(summarize(`coin   ${w}d ≤ ${th * 100}%`, cOs, cEv));
      }
    }
    console.table(out.map(({ label, events, samples, ...rest }) => ({ label, events, samples, ...rest })));
    await prisma.$disconnect();
    return;
  }

  const outcomesAt = (t: number) => {
    const out: Outcome[] = [];
    for (const [s, d] of data) {
      const i = idx.get(s)!.get(t);
      if (i == null || i < 30) continue;
      const o = outcome(d, i);
      if (o) out.push(o);
    }
    return out;
  };

  const rows: ReturnType<typeof summarize>[] = [];
  // Baseline: every day.
  const base: Outcome[] = [];
  const baseBy: Record<string, Outcome[]> = { bull: [], bear: [] };
  for (const t of days) {
    const os = outcomesAt(t);
    base.push(...os);
    const r = regimeOf(t);
    if (r in baseBy) baseBy[r]!.push(...os);
  }
  rows.push(summarize('BASELINE every day', base));
  rows.push(summarize('  baseline bull', baseBy.bull!));
  rows.push(summarize('  baseline bear', baseBy.bear!));

  const eventLog: string[] = [];
  for (const [name, fn] of Object.entries(defs)) {
    const evs: number[] = [];
    for (const t of days) {
      if (!fn(t)) continue;
      if (evs.length && (t - evs[evs.length - 1]!) / DAY < COOLDOWN) continue;
      evs.push(t);
    }
    const all: Outcome[] = [];
    const by: Record<string, { n: number; os: Outcome[] }> = { bull: { n: 0, os: [] }, bear: { n: 0, os: [] } };
    for (const t of evs) {
      const os = outcomesAt(t);
      if (!os.length) continue;
      all.push(...os);
      const r = regimeOf(t);
      if (r in by) { by[r]!.n++; by[r]!.os.push(...os); }
      const s = summarize('', os);
      eventLog.push(`${name}\t${new Date(t).toISOString().slice(0, 10)}\t${r}\tbtc1d ${pct(btc[btcIdx.get(t)!]!.c / btc[btcIdx.get(t)! - 1]!.c - 1)}\talt1d ${pct(altRet(t, 1))}\tn=${os.length}\t+10%≤7d ${s['+10% ≤7d']}\t+15%≤14d ${s['+15% ≤14d']}\tmax7med ${s['max7 med']}\tsimTP10 ${s['sim TP10 avg']}`);
    }
    rows.push(summarize(`${name} all`, all, evs.length));
    rows.push(summarize(`  ${name} bull`, by.bull!.os, by.bull!.n));
    rows.push(summarize(`  ${name} bear`, by.bear!.os, by.bear!.n));
  }

  console.table(rows);
  console.log('\nPer-event:\n' + eventLog.join('\n'));
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
