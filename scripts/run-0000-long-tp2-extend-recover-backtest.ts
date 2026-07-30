/**
 * Time-based intraday LONG with a "give it more time" extension — Bitget Setup tab flow.
 *
 * Base rule (every UTC day):
 *   - Entry : LONG at the OPEN of the 00:00 UTC 1h candle. NO leverage (1x), fixed $notional.
 *   - TP    : +tpPct% (default 2). Checked intra-candle on the high, hours 00:00..07:59.
 *   - BATCH 1 ends at 08:00 UTC (= open of the 08:00 candle). Look at the open P&L:
 *       * P&L >= extendThresholdPct  -> CLOSE EVERYTHING at 08:00.
 *         With the default threshold -0.5 that means: in profit, flat, OR only mildly red
 *         (down to -0.5%) all close here.
 *       * P&L <  extendThresholdPct  -> DO NOT close. The trade rolls into BATCH 2.
 *   - BATCH 2 (08:00..15:59) is damage control only — no longer chasing profit. It closes as
 *     soon as price recovers to the DAMAGE-CONTROL TARGET: entry x (1 + recoverPct/100).
 *       recoverPct = 0    -> exit at breakeven (entry)
 *       recoverPct = -0.5 -> exit at entry - 0.5%
 *   - If the target is never reached, FORCE CLOSE at 16:00 UTC (open of the 16:00 candle).
 *   - No stop-loss anywhere. One trade per day; never spans a UTC day.
 *
 * NOTE on why TP is not re-checked in batch 2: batch 2 only starts when price is below the extend
 * threshold (below entry), and the damage-control target sits at or below entry, strictly below
 * the +2% TP. Price rising from there up to +2% must cross the damage-control target first, so
 * the target always fires earlier. Checking TP in batch 2 would be double-counting.
 *
 * If price is already at/above the target when batch 2 begins (possible when recoverPct is deeper
 * than the extend threshold, e.g. trade is -0.7% while the target is -1%), the exit condition is
 * already true, so the trade closes right there at the 08:00 price.
 *
 * Fees: feePct%/side on both legs. Bitget Setup tab = market orders -> ~0.06%/side measured.
 *
 * Usage:
 *   ts-node --project apps/api/tsconfig.json scripts/run-0000-long-tp2-extend-recover-backtest.ts \
 *     [symbol] [days|YYYY-MM-DD] [tpPct] [checkHour] [deadlineHour] [feePctPerSide] [notional] \
 *     [extendThresholdPct]
 *
 *   # ETH from 2025-01-01, TP +2%, batch1 ends 08:00, batch2 deadline 16:00, extend if worse than -0.5%
 *   ts-node ... scripts/run-0000-long-tp2-extend-recover-backtest.ts ETHUSDT 2025-01-01 2 8 16 0.06 1000 -0.5
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const INTERVAL = '1h';
const ENTRY_HOUR = 0;

type Candle = { openTime: number; open: number; high: number; low: number; close: number; hour: number; year: number };

function fetchJson(url: string): Promise<unknown[]> {
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
      const d = new Date(t);
      out.push({
        openTime: t,
        open: +(k[1] as string),
        high: +(k[2] as string),
        low: +(k[3] as string),
        close: +(k[4] as string),
        hour: d.getUTCHours(),
        year: d.getUTCFullYear(),
      });
    }
    if (batch.length < MAX_PER_REQ) break;
    cur = (batch[batch.length - 1]![0] as number) + 1;
  }
  return out;
}

const fmt = (n: number, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const usd = (n: number) => (n >= 0 ? '+$' : '-$') + fmt(Math.abs(n));
const pct = (n: number, d = 2) => (n >= 0 ? '+' : '') + fmt(n, d) + '%';

/** How the trade ended. */
type Outcome = 'TP' | 'CLOSE08' | 'RECOVER' | 'FORCE_DEADLINE';

type Trade = {
  openTime: number;
  year: number;
  month: string;
  entry: number;
  grossRet: number;
  netRet: number;
  outcome: Outcome;
  extended: boolean;
  hoursHeld: number;
};

function simulate(
  candles: Candle[],
  tpPct: number,
  checkHour: number,
  deadlineHour: number,
  recoverPct: number,
  feePct: number,
  extendThresholdPct = 0,
): Trade[] {
  const f = feePct / 100;
  const tp = tpPct / 100;
  const rec = recoverPct / 100;
  const ext = extendThresholdPct / 100;
  const trades: Trade[] = [];
  const maxBars = ((deadlineHour - ENTRY_HOUR + 24) % 24 || 24) + 4; // safety valve for data gaps

  for (let i = 0; i < candles.length; i++) {
    if (candles[i]!.hour !== ENTRY_HOUR) continue;
    const entry = candles[i]!.open;
    const tpPx = entry * (1 + tp);
    const recPx = entry * (1 + rec);

    let grossRet: number | null = null;
    let outcome: Outcome = 'TP';
    let extended = false;
    let hoursHeld = 0;

    // ---- phase 1: entry .. checkHour, TP only ----
    let k = -1; // index of the checkHour candle
    for (let j = i; j < candles.length && j - i <= maxBars; j++) {
      if (j > i && candles[j]!.hour === checkHour) {
        k = j;
        break;
      }
      if (candles[j]!.high >= tpPx) {
        grossRet = tp;
        outcome = 'TP';
        hoursHeld = j - i + 1;
        break;
      }
    }

    // ---- end of BATCH 1: decision at checkHour ----
    if (grossRet === null && k >= 0) {
      const p8 = candles[k]!.open;
      hoursHeld = k - i;
      if (p8 >= entry * (1 + ext)) {
        // in profit, flat, or only mildly red (>= threshold) -> close everything here
        grossRet = (p8 - entry) / entry;
        outcome = 'CLOSE08';
      } else {
        // worse than the threshold -> roll into BATCH 2 (damage control only)
        extended = true;
        if (p8 >= recPx) {
          // target already satisfied at checkHour (possible only when recoverPct < 0)
          grossRet = (p8 - entry) / entry;
          outcome = 'RECOVER';
        } else {
          for (let j = k; j < candles.length && j - i <= maxBars; j++) {
            if (j > k && candles[j]!.hour === deadlineHour) {
              grossRet = (candles[j]!.open - entry) / entry;
              outcome = 'FORCE_DEADLINE';
              hoursHeld = j - i;
              break;
            }
            if (candles[j]!.high >= recPx) {
              grossRet = rec;
              outcome = 'RECOVER';
              hoursHeld = j - i + 1;
              break;
            }
          }
        }
      }
    }

    if (grossRet === null) continue; // incomplete window at the tail of the data
    const netRet = (1 + grossRet) * (1 - f) * (1 - f) - 1;
    trades.push({
      openTime: candles[i]!.openTime,
      year: candles[i]!.year,
      month: new Date(candles[i]!.openTime).toISOString().slice(0, 7),
      entry,
      grossRet,
      netRet,
      outcome,
      extended,
      hoursHeld,
    });
  }
  return trades;
}

type Stats = {
  trades: number;
  wins: number;
  net: number;
  avg: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  breakevenWR: number;
  best: number;
  worst: number;
  maxLossStreak: number;
  compounded: number;
  maxDDPct: number;
  avgHours: number;
  byOutcome: Map<Outcome, { n: number; net: number }>;
  extended: number;
};

function stats(trades: Trade[], notional: number): Stats {
  let net = 0;
  let wins = 0;
  let gp = 0;
  let gl = 0;
  let best = -Infinity;
  let worst = Infinity;
  let streak = 0;
  let maxLossStreak = 0;
  let eq = notional;
  let peak = notional;
  let maxDD = 0;
  let hours = 0;
  let extended = 0;
  const byOutcome = new Map<Outcome, { n: number; net: number }>();

  for (const t of trades) {
    const pnl = notional * t.netRet;
    net += pnl;
    if (t.netRet > 0) {
      wins++;
      gp += pnl;
      streak = 0;
    } else {
      gl += -pnl;
      streak++;
      if (streak > maxLossStreak) maxLossStreak = streak;
    }
    if (pnl > best) best = pnl;
    if (pnl < worst) worst = pnl;
    hours += t.hoursHeld;
    if (t.extended) extended++;
    const b = byOutcome.get(t.outcome) ?? { n: 0, net: 0 };
    b.n++;
    b.net += pnl;
    byOutcome.set(t.outcome, b);

    eq *= 1 + t.netRet;
    if (eq > peak) peak = eq;
    const dd = ((peak - eq) / peak) * 100;
    if (dd > maxDD) maxDD = dd;
  }

  const n = trades.length;
  const losses = n - wins;
  const avgWin = wins ? gp / wins : 0;
  const avgLoss = losses ? gl / losses : 0;
  return {
    trades: n,
    wins,
    net,
    avg: n ? net / n : 0,
    avgWin,
    avgLoss,
    profitFactor: gl > 0 ? gp / gl : Infinity,
    breakevenWR: avgWin + avgLoss > 0 ? (avgLoss / (avgWin + avgLoss)) * 100 : 0,
    best: best === -Infinity ? 0 : best,
    worst: worst === Infinity ? 0 : worst,
    maxLossStreak,
    compounded: eq,
    maxDDPct: maxDD,
    avgHours: n ? hours / n : 0,
    byOutcome,
    extended,
  };
}

function report(label: string, trades: Trade[], notional: number, deadlineHour: number, checkHour: number): Stats {
  const s = stats(trades, notional);
  const p = (x: number) => fmt((x / s.trades) * 100, 1) + '%';
  console.log(`\n${'='.repeat(96)}\n${label}\n${'='.repeat(96)}`);
  console.log(`  trades : ${s.trades}   ·   avg hold ${fmt(s.avgHours, 1)}h`);

  console.log(`\n  --- how each trade ended ---`);
  const order: Outcome[] = ['TP', 'CLOSE08', 'RECOVER', 'FORCE_DEADLINE'];
  const names: Record<Outcome, string> = {
    TP: `TP +2% hit (before ${String(checkHour).padStart(2, '0')}:00)`,
    CLOSE08: `closed @ ${String(checkHour).padStart(2, '0')}:00, in profit/flat`,
    RECOVER: `recovered to target during extension`,
    FORCE_DEADLINE: `FORCE CLOSE @ ${String(deadlineHour).padStart(2, '0')}:00 (never recovered)`,
  };
  for (const o of order) {
    const b = s.byOutcome.get(o);
    if (!b) continue;
    console.log(`  ${names[o].padEnd(46)} : ${String(b.n).padStart(4)} (${p(b.n).padStart(6)})  net ${usd(b.net).padStart(10)}`);
  }
  console.log(`  ${'→ extended past ' + String(checkHour).padStart(2, '0') + ':00'.padEnd(30)} : ${String(s.extended).padStart(4)} (${p(s.extended)})`);

  console.log(`\n  --- win rate & payoff ---`);
  console.log(`  WIN RATE (net > 0)     : ${s.wins} / ${s.trades} = ${p(s.wins)}`);
  console.log(`  avg WIN / avg LOSS     : ${usd(s.avgWin)} / ${usd(-s.avgLoss)}   (R:R ${fmt(s.avgLoss ? s.avgWin / s.avgLoss : 0)})`);
  console.log(`  profit factor          : ${fmt(s.profitFactor)}`);
  console.log(`  breakeven WR required  : ${fmt(s.breakevenWR, 1)}%   (actual ${p(s.wins)})`);

  console.log(`\n  --- P&L ---`);
  console.log(`  NET P&L      : ${usd(s.net)}   ·   avg ${usd(s.avg)}/trade`);
  console.log(`  best / worst : ${usd(s.best)} / ${usd(s.worst)}`);
  console.log(`  max loss streak : ${s.maxLossStreak}`);
  console.log(`  compounded $${notional} : $${fmt(s.compounded)} (${pct(((s.compounded - notional) / notional) * 100)}) · max DD ${fmt(s.maxDDPct, 1)}%`);
  return s;
}

async function main() {
  const [, , symA, spanA, tpA, chA, dlA, feeA, notA, extA] = process.argv;
  const symbol = (symA ?? 'ETHUSDT').toUpperCase();
  const span = spanA ?? '2025-01-01';
  const tpPct = Number(tpA ?? 2);
  const checkHour = Number(chA ?? 8);
  const deadlineHour = Number(dlA ?? 16);
  const fee = Number(feeA ?? 0.06);
  const notional = Number(notA ?? 1000);
  const extThr = Number(extA ?? -0.5); // roll into batch 2 only if worse than this

  const endMs = Date.now();
  const startMs = /^\d{4}-\d{2}-\d{2}$/.test(span) ? Date.parse(`${span}T00:00:00Z`) : endMs - Number(span) * 864e5;

  console.log(`\nFetching ${symbol} ${INTERVAL} candles from ${new Date(startMs).toISOString().slice(0, 10)}...`);
  const candles = await fetchKlines(symbol, INTERVAL, startMs, endMs);
  if (!candles.length) throw new Error('no candles');
  const first = new Date(candles[0]!.openTime).toISOString().slice(0, 10);
  const last = new Date(candles[candles.length - 1]!.openTime).toISOString().slice(0, 10);
  console.log(`    ${first} → ${last} · ${candles.length} candles · $${notional}/trade · fee ${fee}%/side · no leverage`);
  console.log(
    `    BATCH 1: entry 00:00 → TP +${tpPct}% or close @ ${String(checkHour).padStart(2, '0')}:00 when P&L >= ${pct(extThr, 2)}`,
  );
  console.log(
    `    BATCH 2: only if P&L < ${pct(extThr, 2)} @ ${String(checkHour).padStart(2, '0')}:00 → damage control until ${String(deadlineHour).padStart(2, '0')}:00`,
  );

  // ---- baseline: the original rule (extension disabled -> close at checkHour no matter what).
  // Simulated inline because simulate() always extends when the trade is red at checkHour.
  const base: Trade[] = [];
  {
    const f = fee / 100;
    const tp = tpPct / 100;
    for (let i = 0; i < candles.length; i++) {
      if (candles[i]!.hour !== ENTRY_HOUR) continue;
      const entry = candles[i]!.open;
      const tpPx = entry * (1 + tp);
      let g: number | null = null;
      let oc: Outcome = 'TP';
      let hrs = 0;
      for (let j = i; j < candles.length && j - i <= 12; j++) {
        if (j > i && candles[j]!.hour === checkHour) {
          g = (candles[j]!.open - entry) / entry;
          oc = g >= 0 ? 'CLOSE08' : 'FORCE_DEADLINE';
          hrs = j - i;
          break;
        }
        if (candles[j]!.high >= tpPx) {
          g = tp;
          oc = 'TP';
          hrs = j - i + 1;
          break;
        }
      }
      if (g === null) continue;
      base.push({
        openTime: candles[i]!.openTime,
        year: candles[i]!.year,
        month: new Date(candles[i]!.openTime).toISOString().slice(0, 7),
        entry,
        grossRet: g,
        netRet: (1 + g) * (1 - f) * (1 - f) - 1,
        outcome: oc,
        extended: false,
        hoursHeld: hrs,
      });
    }
  }
  const sBase = report(
    `BASELINE (no extension) — LONG 00:00 · TP +${tpPct}% · hard close @ ${String(checkHour).padStart(2, '0')}:00`,
    base,
    notional,
    checkHour,
    checkHour,
  );

  // ---- case A: batch-2 damage-control target = entry (breakeven) ----
  const tA = simulate(candles, tpPct, checkHour, deadlineHour, 0, fee, extThr);
  const sA = report(
    `CASE A — batch 2 (P&L < ${pct(extThr, 2)} @ ${String(checkHour).padStart(2, '0')}:00) exits when price returns to ENTRY (breakeven), force close ${String(deadlineHour).padStart(2, '0')}:00`,
    tA,
    notional,
    deadlineHour,
    checkHour,
  );

  // ---- case B: batch-2 damage-control target = entry - 0.5% (the trigger level itself) ----
  const tB = simulate(candles, tpPct, checkHour, deadlineHour, -0.5, fee, extThr);
  const sB = report(
    `CASE B — batch 2 (P&L < ${pct(extThr, 2)} @ ${String(checkHour).padStart(2, '0')}:00) exits when price returns to ENTRY − 0.5%, force close ${String(deadlineHour).padStart(2, '0')}:00`,
    tB,
    notional,
    deadlineHour,
    checkHour,
  );

  // ---- side by side ----
  console.log(`\n${'='.repeat(96)}\nSIDE BY SIDE\n${'='.repeat(96)}`);
  const rows: [string, Stats][] = [
    [`baseline (close all ${String(checkHour).padStart(2, '0')}:00)`, sBase],
    ['case A (batch2 → entry)', sA],
    ['case B (batch2 → −0.5%)', sB],
  ];
  console.log('  variant                      | win%  |  R:R |  PF  |  breakevenWR |    NET $   | comp.$   | maxDD  | avg hold');
  console.log(`  ${'-'.repeat(108)}`);
  for (const [label, s] of rows) {
    console.log(
      `  ${label.padEnd(28)} | ${(fmt((s.wins / s.trades) * 100, 1) + '%').padStart(5)} | ${fmt(s.avgLoss ? s.avgWin / s.avgLoss : 0).padStart(4)} | ` +
        `${fmt(s.profitFactor).padStart(4)} | ${(fmt(s.breakevenWR, 1) + '%').padStart(12)} | ${usd(s.net).padStart(10)} | ` +
        `$${fmt(s.compounded).padStart(7)} | ${(fmt(s.maxDDPct, 1) + '%').padStart(6)} | ${fmt(s.avgHours, 1)}h`,
    );
  }

  // ---- sweep: batch-2 damage-control target ----
  console.log(`\n--- SWEEP: batch-2 damage-control target (trigger ${pct(extThr, 2)}, deadline ${String(deadlineHour).padStart(2, '0')}:00) ---`);
  console.log('  target        | win%  |  PF  |    NET $   | comp.$   | maxDD  | batch2 | recovered | forced');
  for (const r of [tpPct, 0, -0.5, -1, -1.5, -2, -3]) {
    const s = stats(simulate(candles, tpPct, checkHour, deadlineHour, r, fee, extThr), notional);
    const rc = s.byOutcome.get('RECOVER')?.n ?? 0;
    const fc = s.byOutcome.get('FORCE_DEADLINE')?.n ?? 0;
    console.log(
      `  ${(r === tpPct ? `NO tgt/TP` : `entry ${pct(r, 2)}`).padStart(12)} | ${(fmt((s.wins / s.trades) * 100, 1) + '%').padStart(5)} | ${fmt(s.profitFactor).padStart(4)} | ` +
        `${usd(s.net).padStart(10)} | $${fmt(s.compounded).padStart(7)} | ${(fmt(s.maxDDPct, 1) + '%').padStart(6)} | ` +
        `${String(s.extended).padStart(6)} | ${String(rc).padStart(9)} | ${String(fc).padStart(6)}`,
    );
  }

  // ---- sweep: batch-2 TRIGGER threshold (how red before you roll into batch 2) ----
  console.log(`\n--- SWEEP: batch-2 trigger threshold (target = trigger level, deadline ${String(deadlineHour).padStart(2, '0')}:00) ---`);
  console.log('  trigger       | win%  |  PF  |    NET $   | comp.$   | maxDD  | batch2 | recovered | forced');
  for (const e of [0, -0.25, -0.5, -1, -1.5, -2, -3]) {
    const s = stats(simulate(candles, tpPct, checkHour, deadlineHour, e, fee, e), notional);
    const rc = s.byOutcome.get('RECOVER')?.n ?? 0;
    const fc = s.byOutcome.get('FORCE_DEADLINE')?.n ?? 0;
    console.log(
      `  P&L < ${pct(e, 2).padStart(6)} | ${(fmt((s.wins / s.trades) * 100, 1) + '%').padStart(5)} | ${fmt(s.profitFactor).padStart(4)} | ` +
        `${usd(s.net).padStart(10)} | $${fmt(s.compounded).padStart(7)} | ${(fmt(s.maxDDPct, 1) + '%').padStart(6)} | ` +
        `${String(s.extended).padStart(6)} | ${String(rc).padStart(9)} | ${String(fc).padStart(6)}`,
    );
  }

  // ---- deadline sweep, for both cases ----
  console.log(`\n--- SWEEP: batch-2 deadline ---`);
  console.log('  deadline | case A: win%   PF     NET $    comp.$  | case B: win%   PF     NET $    comp.$');
  for (const dl of [10, 12, 14, 16, 20, 0]) {
    const a = stats(simulate(candles, tpPct, checkHour, dl, 0, fee, extThr), notional);
    const b = stats(simulate(candles, tpPct, checkHour, dl, -0.5, fee, extThr), notional);
    const cell = (s: Stats) =>
      `${(fmt((s.wins / s.trades) * 100, 1) + '%').padStart(6)} ${fmt(s.profitFactor).padStart(5)} ${usd(s.net).padStart(10)} $${fmt(s.compounded).padStart(7)}`;
    console.log(`  ${(String(dl).padStart(2, '0') + ':00').padStart(8)} |${cell(a)}  |${cell(b)}`);
  }

  // ---- force-close focus: how many trades actually reach the deadline ----
  console.log(`\n--- FORCE-CLOSE @ ${String(deadlineHour).padStart(2, '0')}:00 — how many trades get there ---`);
  const fcStats = (t: Trade[], label: string) => {
    const s = stats(t, notional);
    const forced = t.filter((x) => x.outcome === 'FORCE_DEADLINE');
    const n = forced.length;
    const net = forced.reduce((a, b) => a + notional * b.netRet, 0);
    const worst = forced.reduce((a, b) => Math.min(a, notional * b.netRet), 0);
    const green = forced.filter((x) => x.netRet > 0).length;
    console.log(
      `  ${label.padEnd(26)} | ${String(n).padStart(3)} / ${s.trades} = ${(fmt((n / s.trades) * 100, 1) + '%').padStart(6)} of ALL   ` +
        `| ${(fmt(s.extended ? (n / s.extended) * 100 : 0, 1) + '%').padStart(6)} of batch 2 (${s.extended})   ` +
        `| net ${usd(net).padStart(10)} · avg ${usd(n ? net / n : 0).padStart(8)} · worst ${usd(worst)} · green ${green}`,
    );
  };
  fcStats(tA, 'case A (batch2 → entry)');
  fcStats(tB, 'case B (batch2 → −0.5%)');

  console.log(`\n  by batch-2 damage-control target (trigger ${pct(extThr, 2)}):`);
  // recoverPct === tpPct means "no damage-control target at all": the only batch-2 exit is the
  // +tpPct% TP itself, otherwise the trade rides to the deadline.
  for (const r of [tpPct, 0, -0.5, -1, -1.5, -2, -3]) {
    const label = r === tpPct ? `  NO target (TP +${tpPct}% only)` : `  target entry ${pct(r, 2)}`;
    fcStats(simulate(candles, tpPct, checkHour, deadlineHour, r, fee, extThr), label);
  }

  console.log(`\n  by batch-2 deadline (case A, target = entry):`);
  for (const dl of [10, 12, 14, 16, 20, 0]) {
    fcStats(simulate(candles, tpPct, checkHour, dl, 0, fee, extThr), `  deadline ${String(dl).padStart(2, '0')}:00`);
  }

  const tNo = simulate(candles, tpPct, checkHour, deadlineHour, tpPct, fee, extThr); // no damage-control target
  console.log(`\n  per year (NO target / case A / case B):`);
  for (const y of [...new Set(tA.map((t) => t.year))].sort()) {
    const cnt = (t: Trade[]) => {
      const yt = t.filter((x) => x.year === y);
      const n = yt.filter((x) => x.outcome === 'FORCE_DEADLINE').length;
      return `${String(n).padStart(3)} / ${yt.length} = ${(fmt((n / yt.length) * 100, 1) + '%').padStart(6)}`;
    };
    console.log(`    ${y} : ${cnt(tNo)}   |   ${cnt(tA)}   |   ${cnt(tB)}`);
  }
  console.log(`\n  NO-target variant, per-month force-close rate:`);
  for (const m of [...new Set(tNo.map((t) => t.month))].sort()) {
    const mt = tNo.filter((t) => t.month === m);
    const n = mt.filter((t) => t.outcome === 'FORCE_DEADLINE').length;
    console.log(`    ${m} : ${String(n).padStart(2)} / ${String(mt.length).padStart(2)} = ${(fmt((n / mt.length) * 100, 0) + '%').padStart(5)}`);
  }

  // ---- per year ----
  console.log(`\n--- PER YEAR ---`);
  console.log('  year | baseline NET   | case A NET     | case B NET');
  const years = [...new Set(base.map((t) => t.year))].sort();
  for (const y of years) {
    const f = (ts: Trade[]) => usd(stats(ts.filter((t) => t.year === y), notional).net).padStart(10);
    console.log(`  ${y} | ${f(base)}     | ${f(tA)}     | ${f(tB)}`);
  }

  // ---- fee sensitivity ----
  console.log(`\n--- FEE SENSITIVITY ---`);
  console.log('  fee/side | baseline NET   | case A NET     | case B NET');
  for (const fv of [0, 0.02, 0.05, 0.06, 0.1]) {
    const a = stats(simulate(candles, tpPct, checkHour, deadlineHour, 0, fv, extThr), notional);
    const b = stats(simulate(candles, tpPct, checkHour, deadlineHour, -0.5, fv, extThr), notional);
    // recompute baseline at this fee
    const fr = fv / 100;
    const bs = stats(
      base.map((t) => ({ ...t, netRet: (1 + t.grossRet) * (1 - fr) * (1 - fr) - 1 })),
      notional,
    );
    console.log(`  ${(fmt(fv, 2) + '%').padStart(8)} | ${usd(bs.net).padStart(10)}     | ${usd(a.net).padStart(10)}     | ${usd(b.net).padStart(10)}`);
  }

  const bh = (candles[candles.length - 1]!.close - candles[0]!.open) / candles[0]!.open;
  console.log(`\n--- REFERENCE ---\n  ${symbol} buy & hold: ${pct(bh * 100)}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
