/**
 * Backtest harness for the /day-trading BTCUSDT scalping strategy.
 *
 * Walk-forward replay (NO lookahead): at each historical 15m close it rebuilds the
 * exact production input (last 50×15m, 40×1H, 30×4H up to that bar) and runs the
 * REAL SetupAnalyzerService.analyze() — so it measures the live detection logic,
 * not a copy. When a signal fires it simulates forward 15m candles to see whether
 * TP or SL is touched first, then scores the trade in R and in fee-adjusted USD.
 *
 * Single-position model: while a trade is open, new signals are skipped (mirrors a
 * trader who only holds one BTC scalp at a time and avoids stacking correlated risk).
 *
 * Conservative tie-break: if a single forward candle's range spans BOTH TP and SL,
 * the SL is assumed hit first (pessimistic — we can't see intrabar order from candles).
 *
 * Run:
 *   pnpm --filter worker backtest:daytrading -- --days=60
 *   pnpm --filter worker backtest:daytrading -- --days=90 --min-rr=2 --risk=2 --fee=0.0006 --csv=/tmp/dt.csv
 *   pnpm --filter worker backtest:daytrading -- --days=60 --expiry-bars=192 --allow-stack
 */
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as dotenv from 'dotenv';
import axios from 'axios';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

import { Logger } from '@nestjs/common';
import { SetupAnalyzerService } from '../modules/day-trading/setup-analyzer.service';
import type { Candle } from '../modules/day-trading/bitget.service';

// Silence the analyzer's per-bar DEBUG rejection logs — we only want the report.
Logger.overrideLogger(['error', 'warn']);

const DAY_MS = 86_400_000;
const SYMBOL = 'BTCUSDT';

// ── CLI args ──────────────────────────────────────────────────────────────────
type Args = {
  days: number;
  minRr: number;
  minStopPct: number;
  atrMult: number;        // 0 = fixed-% floor; >0 = ATR-based stop floor (k×ATR14)
  risk: number;
  feePerSide: number;     // taker fee fraction per side (round trip = 2×)
  expiryBars: number;     // forward entry-TF bars before mark-to-market exit
  allowStack: boolean;    // allow overlapping positions (default: single position)
  tie: 'sl' | 'tp';       // intrabar tie-break when a candle spans both TP and SL
  entryTf: Granularity;   // entry timeframe (the "15m" slot)
  midTf: Granularity;     // mid regime timeframe (the "1H" slot)
  highTf: Granularity;    // high regime timeframe (the "4H" slot)
  mgmt: Mgmt | null;      // trade management (partial + break-even); null = static
  csv: string | null;
};

function parseArgs(argv: string[]): Args {
  const get = (k: string) => {
    const hit = argv.find((a) => a.startsWith(`--${k}=`));
    return hit ? hit.slice(k.length + 3) : null;
  };
  const num = (v: string | null, d: number) => (v == null || v === '' ? d : Number(v));
  const tf = (v: string | null, d: Granularity): Granularity =>
    v && (GRANULARITIES as readonly string[]).includes(v) ? (v as Granularity) : d;
  return {
    days: num(get('days'), 60),
    minRr: num(get('min-rr'), 2),
    minStopPct: num(get('min-stop'), 0.005),
    atrMult: num(get('atr'), 0),
    risk: num(get('risk'), 2),
    feePerSide: num(get('fee'), 0.0006),       // Bitget USDT-M taker ≈ 0.06%
    expiryBars: num(get('expiry-bars'), 192),
    allowStack: argv.includes('--allow-stack'),
    tie: get('tie') === 'tp' ? 'tp' : 'sl',
    entryTf: tf(get('entry-tf'), '15m'),
    midTf: tf(get('mid-tf'), '1H'),
    highTf: tf(get('high-tf'), '4H'),
    // Trade management is OFF by default — backtest showed partial-at-1R + move-to-BE
    // caps the fat-tail winners this trend strategy relies on, hurting net P&L.
    // Pass --managed to experiment (partial 50% at +1R, stop → break-even).
    mgmt: argv.includes('--managed')
      ? { partialFraction: num(get('partial'), 0.5), partialAtR: num(get('partial-at-r'), 1) }
      : null,
    csv: get('csv'),
  };
}

// ── Bitget history fetch (paginated backward) ──────────────────────────────────
const GRANULARITIES = ['1m', '3m', '5m', '15m', '30m', '1H', '4H'] as const;
type Granularity = (typeof GRANULARITIES)[number];

// Approx minutes per granularity — used to size warmup / forward windows by time.
const TF_MINUTES: Record<Granularity, number> = {
  '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30, '1H': 60, '4H': 240,
};

async function fetchHistory(granularity: Granularity, fromMs: number): Promise<Candle[]> {
  const client = axios.create({ baseURL: 'https://api.bitget.com', timeout: 15_000 });
  const byTs = new Map<number, Candle>();
  let endTime = Date.now();

  for (let page = 0; page < 400; page++) {
    const resp = await client.get<{ code: string; msg: string; data: string[][] }>(
      '/api/v2/mix/market/history-candles',
      { params: { symbol: SYMBOL, productType: 'usdt-futures', granularity, endTime, limit: 200 } },
    );
    if (resp.data.code !== '00000') throw new Error(`Bitget ${granularity}: ${resp.data.msg}`);
    const rows = resp.data.data;
    if (!rows || rows.length === 0) break;

    for (const r of rows) {
      const ts = Number(r[0] ?? 0);
      byTs.set(ts, {
        timestamp: ts,
        open: parseFloat(r[1] ?? '0'),
        high: parseFloat(r[2] ?? '0'),
        low: parseFloat(r[3] ?? '0'),
        close: parseFloat(r[4] ?? '0'),
        volume: parseFloat(r[6] ?? '0'),  // quote volume — matches BitgetService mapping
      });
    }
    const earliest = Math.min(...rows.map((r) => Number(r[0] ?? 0)));
    if (earliest <= fromMs) break;
    endTime = earliest;            // next page ends where this one began
    await new Promise((res) => setTimeout(res, 120)); // be gentle on the public API
  }

  return [...byTs.values()].sort((a, b) => a.timestamp - b.timestamp);
}

// ── Forward simulation ──────────────────────────────────────────────────────────
// Outcomes: TP = final target hit; SL = original stop (full loss); BE = partial
// taken then remainder stopped at break-even (small win); EXPIRED = mark-to-market.
type Outcome = 'TP' | 'SL' | 'BE' | 'EXPIRED';

type SimResult = { outcome: Outcome; grossR: number; barsHeld: number };

type Mgmt = { partialFraction: number; partialAtR: number };

/** Static TP/SL (no trade management). Returns realized R directly. */
function simulateStatic(
  direction: 'LONG' | 'SHORT', entry: number, sl: number, tp: number,
  window: Candle[], tie: 'sl' | 'tp',
): SimResult {
  const risk = Math.abs(entry - sl);
  const rr = Math.abs(tp - entry) / risk;
  for (let i = 0; i < window.length; i++) {
    const c = window[i]!;
    const hitTp = direction === 'LONG' ? c.high >= tp : c.low <= tp;
    const hitSl = direction === 'LONG' ? c.low <= sl : c.high >= sl;
    if (hitTp && hitSl) return tie === 'tp'
      ? { outcome: 'TP', grossR: rr, barsHeld: i + 1 }
      : { outcome: 'SL', grossR: -1, barsHeld: i + 1 };
    if (hitTp) return { outcome: 'TP', grossR: rr, barsHeld: i + 1 };
    if (hitSl) return { outcome: 'SL', grossR: -1, barsHeld: i + 1 };
  }
  const last = window.at(-1);
  const exit = last ? last.close : entry;
  const mtm = (direction === 'LONG' ? exit - entry : entry - exit) / risk;
  return { outcome: 'EXPIRED', grossR: mtm, barsHeld: window.length };
}

/**
 * Managed exit: take `partialFraction` off at +`partialAtR` and move the stop on
 * the remainder to break-even (entry). The remainder then runs to the final TP
 * or the break-even stop. Caps the downside of trades that spike in-favour then
 * reverse — turning many would-be −1R losers into small +partial wins.
 */
function simulateManaged(
  direction: 'LONG' | 'SHORT', entry: number, sl: number, tp: number,
  window: Candle[], tie: 'sl' | 'tp', mgmt: Mgmt,
): SimResult {
  const risk = Math.abs(entry - sl);
  const rr = Math.abs(tp - entry) / risk;
  const frac = mgmt.partialFraction;
  const partialR = frac * mgmt.partialAtR;          // R booked when the partial fills
  const partialLevel = direction === 'LONG' ? entry + mgmt.partialAtR * risk : entry - mgmt.partialAtR * risk;
  let partialDone = false;

  for (let i = 0; i < window.length; i++) {
    const c = window[i]!;
    const hitTp = direction === 'LONG' ? c.high >= tp : c.low <= tp;

    if (!partialDone) {
      const hitSl = direction === 'LONG' ? c.low <= sl : c.high >= sl;
      const hitPartial = direction === 'LONG' ? c.high >= partialLevel : c.low <= partialLevel;
      // Big candle that spans original SL and the upside: tie-break decides.
      if (hitSl && (hitPartial || hitTp) && tie === 'sl') return { outcome: 'SL', grossR: -1, barsHeld: i + 1 };
      if (hitSl && !hitPartial && !hitTp) return { outcome: 'SL', grossR: -1, barsHeld: i + 1 };
      if (hitPartial) {
        partialDone = true;                          // 50% booked, stop → break-even
        if (hitTp) return { outcome: 'TP', grossR: partialR + (1 - frac) * rr, barsHeld: i + 1 };
        continue;
      }
      if (hitSl) return { outcome: 'SL', grossR: -1, barsHeld: i + 1 };
    } else {
      const hitBe = direction === 'LONG' ? c.low <= entry : c.high >= entry;
      if (hitTp && hitBe) return tie === 'tp'
        ? { outcome: 'TP', grossR: partialR + (1 - frac) * rr, barsHeld: i + 1 }
        : { outcome: 'BE', grossR: partialR, barsHeld: i + 1 };
      if (hitTp) return { outcome: 'TP', grossR: partialR + (1 - frac) * rr, barsHeld: i + 1 };
      if (hitBe) return { outcome: 'BE', grossR: partialR, barsHeld: i + 1 };
    }
  }

  // Mark-to-market on the remainder at the last close.
  const last = window.at(-1);
  const exit = last ? last.close : entry;
  const mtm = (direction === 'LONG' ? exit - entry : entry - exit) / risk;
  const grossR = partialDone ? partialR + (1 - frac) * mtm : mtm;
  return { outcome: 'EXPIRED', grossR, barsHeld: window.length };
}

function simulate(
  direction: 'LONG' | 'SHORT', entry: number, sl: number, tp: number,
  fwd: Candle[], expiryBars: number, tie: 'sl' | 'tp', mgmt: Mgmt | null,
): SimResult {
  const window = fwd.slice(0, expiryBars);
  return mgmt ? simulateManaged(direction, entry, sl, tp, window, tie, mgmt)
    : simulateStatic(direction, entry, sl, tp, window, tie);
}

// ── Metrics ───────────────────────────────────────────────────────────────────
type Trade = {
  side: 'LONG' | 'SHORT';
  setupType: string;
  outcome: Outcome;
  grossR: number;       // R before fees (SL = -1)
  netR: number;         // R after round-trip fee
  pnlUsd: number;       // fee-adjusted USD on fixed risk
  rr: number;
  barsHeld: number;
  t: number;
};

type Bucket = { n: number; tp: number; sl: number; be: number; exp: number; sumGrossR: number; sumNetR: number; sumPnl: number; netRs: number[] };
const emptyBucket = (): Bucket => ({ n: 0, tp: 0, sl: 0, be: 0, exp: 0, sumGrossR: 0, sumNetR: 0, sumPnl: 0, netRs: [] });

function add(b: Bucket, t: Trade) {
  b.n++;
  if (t.outcome === 'TP') b.tp++;
  else if (t.outcome === 'SL') b.sl++;
  else if (t.outcome === 'BE') b.be++;
  else b.exp++;
  b.sumGrossR += t.grossR;
  b.sumNetR += t.netR;
  b.sumPnl += t.pnlUsd;
  b.netRs.push(t.netR);
}

function maxDrawdown(rs: number[]): number {
  let peak = 0, equity = 0, mdd = 0;
  for (const r of rs) { equity += r; peak = Math.max(peak, equity); mdd = Math.min(mdd, equity - peak); }
  return mdd;
}

function fmtBucket(name: string, b: Bucket): string {
  // BE (partial win + break-even remainder) counts as a win for win-rate.
  const resolved = b.tp + b.sl + b.be;
  const wr = resolved > 0 ? ((b.tp + b.be) / resolved) * 100 : 0;
  const eGross = b.n > 0 ? b.sumGrossR / b.n : 0;
  const eNet = b.n > 0 ? b.sumNetR / b.n : 0;
  const wins = b.netRs.filter((r) => r > 0).reduce((s, r) => s + r, 0);
  const losses = b.netRs.filter((r) => r < 0).reduce((s, r) => s - r, 0);
  const pf = losses > 0 ? wins / losses : (wins > 0 ? Infinity : 0);
  return [
    name.padEnd(20),
    `n=${String(b.n).padStart(4)}`,
    `TP/BE/SL/exp=${b.tp}/${b.be}/${b.sl}/${b.exp}`.padEnd(21),
    `win%=${wr.toFixed(1).padStart(5)}`,
    `E[R]gross=${eGross.toFixed(3).padStart(7)}`,
    `E[R]net=${eNet.toFixed(3).padStart(7)}`,
    `PF=${(pf === Infinity ? '∞' : pf.toFixed(2)).padStart(5)}`,
    `netUSD=${b.sumPnl.toFixed(1).padStart(8)}`,
    `MDD=${maxDrawdown(b.netRs).toFixed(1).padStart(6)}R`,
  ].join('  ');
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const analyzer = new SetupAnalyzerService();

  console.log(`\nBacktest /day-trading ${SYMBOL} — days=${args.days}`);
  console.log(
    `minRR=${args.minRr}  stop=${args.atrMult > 0 ? `${args.atrMult}×ATR14` : `${(args.minStopPct * 100).toFixed(2)}% fixed`}  risk=$${args.risk}  fee/side=${(args.feePerSide * 100).toFixed(3)}% ` +
      `(round-trip ${(args.feePerSide * 2 * 100).toFixed(3)}%)  expiry=${args.expiryBars} bars  ` +
      `mode=${args.allowStack ? 'STACKED' : 'single-position'}  tie-break=${args.tie.toUpperCase()}-first  ` +
      `TF=${args.entryTf}/${args.midTf}/${args.highTf}  ` +
      `mgmt=${args.mgmt ? `partial ${args.mgmt.partialFraction * 100}%@${args.mgmt.partialAtR}R→BE` : 'static'}\n`,
  );

  const fromMs = Date.now() - (args.days + 5) * DAY_MS;
  console.log(`Fetching Bitget history (${args.entryTf} / ${args.midTf} / ${args.highTf})…`);
  const [cEntry, cMid, cHigh] = await Promise.all([
    fetchHistory(args.entryTf, fromMs),
    fetchHistory(args.midTf, fromMs),
    fetchHistory(args.highTf, fromMs),
  ]);
  console.log(`  ${args.entryTf}=${cEntry.length}  ${args.midTf}=${cMid.length}  ${args.highTf}=${cHigh.length} candles\n`);

  if (cEntry.length < 100) { console.error('Insufficient entry-TF history.'); process.exit(1); }

  const trades: Trade[] = [];
  let testedBars = 0, openUntilTs = 0;

  // Start once we have enough warmup for the largest slice the analyzer needs.
  for (let i = 50; i < cEntry.length; i++) {
    const T = cEntry[i]!.timestamp;

    // Single-position: skip while a prior trade is still open.
    if (!args.allowStack && T < openUntilTs) continue;

    // Build production-faithful slices: candles fully CLOSED by T (no lookahead).
    const sEntry = cEntry.slice(Math.max(0, i - 49), i + 1);          // last 50 entry-TF incl. current close
    const sMid = cMid.filter((c) => c.timestamp <= T).slice(-40);     // last 40 mid-TF
    const sHigh = cHigh.filter((c) => c.timestamp <= T).slice(-30);   // last 30 high-TF
    if (sMid.length < 20 || sHigh.length < 10) continue;

    testedBars++;

    const setup = analyzer.analyze(sEntry, sMid, sHigh, {
      riskPerTrade: args.risk, minRR: args.minRr, minStopPct: args.minStopPct,
      ...(args.atrMult > 0 ? { atrMult: args.atrMult } : {}),
    });
    if (!setup) continue;

    const fwd = cEntry.slice(i + 1);
    if (fwd.length < 1) continue;

    const sim = simulate(setup.direction, setup.entryPrice, setup.stopLoss, setup.takeProfit, fwd, args.expiryBars, args.tie, args.mgmt);

    const risk = Math.abs(setup.entryPrice - setup.stopLoss);
    const grossR = sim.grossR;

    // Fee in R units: round-trip fee on notional, expressed against the fixed $risk.
    // feeUsd = 2·feePerSide·notional ; feeR = feeUsd / risk$ = 2·fee·(entry/|entry-SL|)
    // Partial exits split the same notional across two fills, so round-trip fee is ~unchanged.
    const feeR = 2 * args.feePerSide * (setup.entryPrice / risk);
    const netR = grossR - feeR;
    const pnlUsd = netR * args.risk;

    const tr: Trade = {
      side: setup.direction,
      setupType: setup.setupType,
      outcome: sim.outcome,
      grossR, netR, pnlUsd,
      rr: setup.rrRatio,
      barsHeld: sim.barsHeld,
      t: T,
    };
    trades.push(tr);

    // Reserve the position until exit (single-position mode).
    openUntilTs = (fwd[Math.min(sim.barsHeld, fwd.length) - 1]?.timestamp ?? T) + 1;
  }

  // ── Report ──
  const overall = emptyBucket();
  const bySide: Record<string, Bucket> = { LONG: emptyBucket(), SHORT: emptyBucket() };
  const bySetup: Record<string, Bucket> = {};
  for (const t of trades) {
    add(overall, t);
    add(bySide[t.side]!, t);
    (bySetup[t.setupType] ??= emptyBucket());
    add(bySetup[t.setupType]!, t);
  }

  const avgHold = trades.length ? trades.reduce((s, t) => s + t.barsHeld, 0) / trades.length : 0;

  console.log('── By setup ────────────────────────────────────────────────────────────────────────');
  for (const k of Object.keys(bySetup)) console.log(fmtBucket(k, bySetup[k]!));
  console.log('── By side ─────────────────────────────────────────────────────────────────────────');
  for (const k of ['LONG', 'SHORT']) if (bySide[k]!.n > 0) console.log(fmtBucket(k, bySide[k]!));
  console.log('────────────────────────────────────────────────────────────────────────────────────');
  console.log(fmtBucket('OVERALL', overall));
  console.log(
    `\nTested 15m closes: ${testedBars}  |  signals: ${trades.length}  ` +
      `(${testedBars ? ((trades.length / testedBars) * 100).toFixed(2) : 0}% fire rate)  ` +
      `|  avg hold: ${(avgHold * TF_MINUTES[args.entryTf] / 60).toFixed(1)}h`,
  );
  console.log(
    'E[R] = expectancy/trade in R (SL=-1). net = after round-trip taker fee. ' +
      'PF = profit factor. netUSD = total fee-adjusted P&L on fixed risk.\n',
  );

  if (args.csv) {
    const rows = ['time,side,setup,outcome,rr,grossR,netR,pnlUsd,barsHeld',
      ...trades.map((t) => `${new Date(t.t).toISOString()},${t.side},${t.setupType},${t.outcome},${t.rr.toFixed(2)},${t.grossR.toFixed(4)},${t.netR.toFixed(4)},${t.pnlUsd.toFixed(2)},${t.barsHeld}`)];
    fs.writeFileSync(args.csv, rows.join('\n'));
    console.log(`Wrote ${trades.length} trades → ${args.csv}\n`);
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
