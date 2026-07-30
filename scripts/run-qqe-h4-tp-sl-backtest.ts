/**
 * Backtest the QQE Signals arrows shown on the /bitget Setup-tab chart.
 *
 * Reuses the EXACT live indicator (`calculateQqe` from @app/core) with the EXACT params the
 * chart renderer uses (`QQE_PARAMS` in apps/api/.../setup-chart-renderer.ts):
 *   rsiPeriod 10 · smoothing 4 · qqeFactor 3.2
 * (`threshold` only positions a visual band in colinmck's study, it does not affect the arrows.)
 * NOTE: these are NOT calculateQqe's own defaults (14/5/4.238) — the chart overrides them, so the
 * defaults would produce different arrows than the ones the trader actually sees.
 *
 * Rules:
 *   - Entry: an H4 candle CLOSES with a QQE arrow. Green ▲ (`cross === 'long'`) opens a LONG at
 *     that candle's close; red ▼ (`cross === 'short'`) opens a SHORT at that close.
 *   - Exit: fixed TP +tpPct% / SL -slPct% from entry, checked intra-candle on high/low.
 *   - One position at a time. Arrows that fire while a position is open are IGNORED
 *     (`--flip` instead closes the position at that close and opens the opposite side).
 *   - No leverage (1x), fixed $notional per trade, fee feePct%/side on both legs.
 *   - The still-open position at the end of the data is marked to the last close and reported
 *     separately, never counted as a closed trade.
 *
 * Intra-candle ambiguity: when a single candle's high reaches TP *and* its low reaches SL, the
 * true order is unknowable from OHLC. The headline numbers assume the SL fires first
 * (pessimistic); the report also prints the optimistic (TP-first) variant and the count of
 * ambiguous candles so the size of the assumption is visible.
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-qqe-h4-tp-sl-backtest.ts [symbol] [days|YYYY-MM-DD] [tpPct] [slPct] \
 *       [interval] [feePctPerSide] [notional] [--flip]
 *
 *   # ETH H4, TP +10% / SL -20%, full history
 *   ... scripts/run-qqe-h4-tp-sl-backtest.ts ETHUSDT 3200 10 20 4h 0.06 1000
 */
import * as https from 'https';
import { calculateQqe, type QqeCross } from '@app/core';

// Mirrors QQE_PARAMS in apps/api/src/modules/bitget/setup-chart-renderer.ts.
const QQE = { rsiPeriod: 10, smoothing: 4, qqeFactor: 3.2 } as const;

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;

type Candle = { openTime: number; open: number; high: number; low: number; close: number; year: number };

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
      out.push({
        openTime: t,
        open: +(k[1] as string),
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

const fmt = (n: number, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const usd = (n: number) => (n >= 0 ? '+$' : '-$') + fmt(Math.abs(n));
const pct = (n: number, d = 2) => (n >= 0 ? '+' : '') + fmt(n, d) + '%';
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

type Side = 'long' | 'short';
type Exit = 'TP' | 'SL' | 'FLIP' | 'OPEN';
type Trade = {
  side: Side;
  entryTime: number;
  exitTime: number;
  entry: number;
  exit: number;
  grossRet: number; // directional, before fees
  netRet: number;
  reason: Exit;
  bars: number;
  ambiguous: boolean; // a single candle touched both TP and SL
  year: number;
};

type Opts = {
  tpPct: number;
  slPct: number;
  feePct: number;
  sides: Side[]; // which arrows to trade
  flip: boolean; // close + reverse on an opposite arrow
  tpFirst: boolean; // ambiguous-candle assumption
};

function simulate(candles: Candle[], cross: QqeCross[], o: Opts): { trades: Trade[]; openTrade: Trade | null } {
  const f = o.feePct / 100;
  const tp = o.tpPct / 100;
  const sl = o.slPct / 100;
  const trades: Trade[] = [];

  let pos: { side: Side; entry: number; entryTime: number; entryIdx: number } | null = null;
  let ambiguous = false;

  const close = (side: Side, entry: number, exitPx: number, i: number, reason: Exit, entryTime: number, entryIdx: number) => {
    const gross = side === 'long' ? (exitPx - entry) / entry : (entry - exitPx) / entry;
    trades.push({
      side,
      entryTime,
      exitTime: candles[i]!.openTime,
      entry,
      exit: exitPx,
      grossRet: gross,
      netRet: (1 + gross) * (1 - f) * (1 - f) - 1,
      reason,
      bars: i - entryIdx,
      ambiguous,
      year: new Date(entryTime).getUTCFullYear(),
    });
    ambiguous = false;
  };

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;

    // ---- manage an open position on this candle (entry bar excluded: entry is at its close) ----
    if (pos && i > pos.entryIdx) {
      const tpPx = pos.side === 'long' ? pos.entry * (1 + tp) : pos.entry * (1 - tp);
      const slPx = pos.side === 'long' ? pos.entry * (1 - sl) : pos.entry * (1 + sl);
      const hitTP = pos.side === 'long' ? c.high >= tpPx : c.low <= tpPx;
      const hitSL = pos.side === 'long' ? c.low <= slPx : c.high >= slPx;

      if (hitTP && hitSL) ambiguous = true;
      if (hitTP && hitSL) {
        const px = o.tpFirst ? tpPx : slPx;
        close(pos.side, pos.entry, px, i, o.tpFirst ? 'TP' : 'SL', pos.entryTime, pos.entryIdx);
        pos = null;
      } else if (hitTP) {
        close(pos.side, pos.entry, tpPx, i, 'TP', pos.entryTime, pos.entryIdx);
        pos = null;
      } else if (hitSL) {
        close(pos.side, pos.entry, slPx, i, 'SL', pos.entryTime, pos.entryIdx);
        pos = null;
      }
    }

    // ---- act on this candle's arrow (fires on its close) ----
    const sig = cross[i];
    if (!sig) continue;
    const tradable = o.sides.includes(sig);

    if (pos) {
      // opposite arrow while in position
      if (o.flip && sig !== pos.side) {
        close(pos.side, pos.entry, c.close, i, 'FLIP', pos.entryTime, pos.entryIdx);
        pos = tradable ? { side: sig, entry: c.close, entryTime: c.openTime, entryIdx: i } : null;
      }
      continue; // otherwise ignore arrows while already positioned
    }
    if (tradable) pos = { side: sig, entry: c.close, entryTime: c.openTime, entryIdx: i };
  }

  let openTrade: Trade | null = null;
  if (pos) {
    const last = candles[candles.length - 1]!;
    const gross = pos.side === 'long' ? (last.close - pos.entry) / pos.entry : (pos.entry - last.close) / pos.entry;
    openTrade = {
      side: pos.side,
      entryTime: pos.entryTime,
      exitTime: last.openTime,
      entry: pos.entry,
      exit: last.close,
      grossRet: gross,
      netRet: (1 + gross) * (1 - f) * (1 - f) - 1,
      reason: 'OPEN',
      bars: candles.length - 1 - pos.entryIdx,
      ambiguous: false,
      year: new Date(pos.entryTime).getUTCFullYear(),
    };
  }
  return { trades, openTrade };
}

type Stats = {
  n: number;
  wins: number;
  tp: number;
  sl: number;
  flip: number;
  net: number;
  avg: number;
  avgWin: number;
  avgLoss: number;
  pf: number;
  breakevenWR: number;
  best: number;
  worst: number;
  maxLossStreak: number;
  compounded: number;
  maxDDPct: number;
  avgBars: number;
  ambiguous: number;
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
  let bars = 0;
  let amb = 0;
  const by = { TP: 0, SL: 0, FLIP: 0, OPEN: 0 };

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
    by[t.reason]++;
    bars += t.bars;
    if (t.ambiguous) amb++;
    eq *= 1 + t.netRet;
    if (eq > peak) peak = eq;
    const dd = ((peak - eq) / peak) * 100;
    if (dd > maxDD) maxDD = dd;
  }

  const losses = trades.length - wins;
  const avgWin = wins ? gp / wins : 0;
  const avgLoss = losses ? gl / losses : 0;
  return {
    n: trades.length,
    wins,
    tp: by.TP,
    sl: by.SL,
    flip: by.FLIP,
    net,
    avg: trades.length ? net / trades.length : 0,
    avgWin,
    avgLoss,
    pf: gl > 0 ? gp / gl : Infinity,
    breakevenWR: avgWin + avgLoss > 0 ? (avgLoss / (avgWin + avgLoss)) * 100 : 0,
    best: best === -Infinity ? 0 : best,
    worst: worst === Infinity ? 0 : worst,
    maxLossStreak,
    compounded: eq,
    maxDDPct: maxDD,
    avgBars: trades.length ? bars / trades.length : 0,
    ambiguous: amb,
  };
}

function report(label: string, trades: Trade[], open: Trade | null, notional: number, barHours: number) {
  const s = stats(trades, notional);
  if (!s.n) {
    console.log(`\n=== ${label} ===\n  no closed trades`);
    return s;
  }
  const p = (x: number) => fmt((x / s.n) * 100, 1) + '%';
  console.log(`\n${'='.repeat(92)}\n${label}\n${'='.repeat(92)}`);
  console.log(`  closed trades : ${s.n}   ·   avg hold ${fmt(s.avgBars, 1)} bars (${fmt((s.avgBars * barHours) / 24, 1)} days)`);
  console.log(`  exits         : TP ${s.tp} (${p(s.tp)}) · SL ${s.sl} (${p(s.sl)})${s.flip ? ` · FLIP ${s.flip} (${p(s.flip)})` : ''}`);
  console.log(`  WIN RATE      : ${s.wins} / ${s.n} = ${p(s.wins)}`);
  console.log(`  avg WIN/LOSS  : ${usd(s.avgWin)} / ${usd(-s.avgLoss)}   (R:R ${fmt(s.avgLoss ? s.avgWin / s.avgLoss : 0)})`);
  console.log(`  profit factor : ${fmt(s.pf)}`);
  console.log(`  breakeven WR  : ${fmt(s.breakevenWR, 1)}%   (actual ${p(s.wins)})`);
  console.log(`  NET P&L       : ${usd(s.net)}   ·   avg ${usd(s.avg)}/trade`);
  console.log(`  best / worst  : ${usd(s.best)} / ${usd(s.worst)}   ·   max loss streak ${s.maxLossStreak}`);
  console.log(
    `  compounded $${notional} : $${fmt(s.compounded)} (${pct(((s.compounded - notional) / notional) * 100)}) · max DD ${fmt(s.maxDDPct, 1)}%`,
  );
  if (s.ambiguous) console.log(`  ⚠ ambiguous candles (TP & SL in the same bar): ${s.ambiguous} (${p(s.ambiguous)})`);
  if (open) console.log(`  open at end   : ${open.side.toUpperCase()} from ${iso(open.entryTime)} @ ${fmt(open.entry, 4)} → mark ${pct(open.netRet * 100)}`);
  return s;
}

async function main() {
  const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const flip = process.argv.includes('--flip');
  const symbol = (argv[0] ?? 'ETHUSDT').toUpperCase();
  const span = argv[1] ?? '3200';
  const tpPct = Number(argv[2] ?? 10);
  const slPct = Number(argv[3] ?? 20);
  const interval = argv[4] ?? '4h';
  const feePct = Number(argv[5] ?? 0.06);
  const notional = Number(argv[6] ?? 1000);
  const barHours = interval === '4h' ? 4 : interval === '1h' ? 1 : interval === '1d' ? 24 : 4;

  const endMs = Date.now();
  const startMs = /^\d{4}-\d{2}-\d{2}$/.test(span) ? Date.parse(`${span}T00:00:00Z`) : endMs - Number(span) * 864e5;

  console.log(`\nFetching ${symbol} ${interval} from ${new Date(startMs).toISOString().slice(0, 10)}...`);
  const candles = await fetchKlines(symbol, interval, startMs, endMs);
  if (!candles.length) throw new Error('no candles');
  const closes = candles.map((c) => c.close);
  const { cross } = calculateQqe(closes, QQE.rsiPeriod, QQE.smoothing, QQE.qqeFactor);

  const nLong = cross.filter((c) => c === 'long').length;
  const nShort = cross.filter((c) => c === 'short').length;
  console.log(
    `\n=== ${symbol} · QQE Signals (${QQE.rsiPeriod},${QQE.smoothing},${QQE.qqeFactor}) · ${interval} · TP +${tpPct}% / SL −${slPct}% · no leverage ===`,
  );
  console.log(`    data ${iso(candles[0]!.openTime)} → ${iso(candles[candles.length - 1]!.openTime)} · ${candles.length} bars`);
  console.log(`    $${notional}/trade fixed · fee ${feePct}%/side · arrows: ${nLong} ▲ long, ${nShort} ▼ short (${nLong + nShort} total)`);
  console.log(`    ⚠ R:R = ${fmt(tpPct / slPct)} → needs > ${fmt((slPct / (tpPct + slPct)) * 100, 1)}% win rate just to break even (before fees)`);
  if (flip) console.log(`    --flip ON: an opposite arrow closes the position and reverses`);

  const base = { tpPct, slPct, feePct, flip, tpFirst: false };
  const runs: [string, Side[]][] = [
    ['BOTH SIDES (long ▲ + short ▼)', ['long', 'short']],
    ['LONG ONLY (▲)', ['long']],
    ['SHORT ONLY (▼)', ['short']],
  ];
  const results: [string, Stats, Trade[]][] = [];
  for (const [label, sides] of runs) {
    const { trades, openTrade } = simulate(candles, cross, { ...base, sides });
    const s = report(label, trades, openTrade, notional, barHours);
    results.push([label, s, trades]);
  }

  // ---- side by side ----
  console.log(`\n${'='.repeat(92)}\nSIDE BY SIDE\n${'='.repeat(92)}`);
  console.log('  variant                        |  n  | win%  | TP  | SL  |  PF  | breakevenWR |    NET $   | comp.$   | maxDD');
  for (const [label, s] of results) {
    if (!s.n) continue;
    console.log(
      `  ${label.padEnd(30)} | ${String(s.n).padStart(3)} | ${(fmt((s.wins / s.n) * 100, 1) + '%').padStart(5)} | ${String(s.tp).padStart(3)} | ` +
        `${String(s.sl).padStart(3)} | ${fmt(s.pf).padStart(4)} | ${(fmt(s.breakevenWR, 1) + '%').padStart(11)} | ${usd(s.net).padStart(10)} | ` +
        `$${fmt(s.compounded).padStart(7)} | ${fmt(s.maxDDPct, 1)}%`,
    );
  }

  // ---- ambiguity sensitivity ----
  console.log(`\n--- AMBIGUOUS-CANDLE ASSUMPTION (both sides) ---`);
  for (const tpFirst of [false, true]) {
    const s = stats(simulate(candles, cross, { ...base, sides: ['long', 'short'], tpFirst }).trades, notional);
    console.log(
      `  ${tpFirst ? 'TP first (optimistic)' : 'SL first (pessimistic)'} : win ${fmt((s.wins / s.n) * 100, 1)}% · PF ${fmt(s.pf)} · NET ${usd(s.net)} · comp $${fmt(s.compounded)} · ${s.ambiguous} ambiguous`,
    );
  }

  // ---- flip variant ----
  console.log(`\n--- EXIT ON OPPOSITE ARROW (--flip) vs TP/SL ONLY (both sides) ---`);
  for (const fl of [false, true]) {
    const s = stats(simulate(candles, cross, { ...base, sides: ['long', 'short'], flip: fl }).trades, notional);
    console.log(
      `  ${fl ? 'flip ON ' : 'flip OFF'} : n ${String(s.n).padStart(3)} · win ${fmt((s.wins / s.n) * 100, 1)}% · TP ${s.tp} · SL ${s.sl} · FLIP ${s.flip} · PF ${fmt(s.pf)} · NET ${usd(s.net)} · comp $${fmt(s.compounded)} · maxDD ${fmt(s.maxDDPct, 1)}%`,
    );
  }

  // ---- TP/SL grid ----
  console.log(`\n--- TP × SL GRID: NET $ (both sides, fee ${feePct}%/side) ---`);
  const tps = [5, 10, 15, 20, 30];
  const sls = [5, 10, 15, 20, 30];
  console.log('   TP\\SL |' + sls.map((s) => `${s}%`.padStart(11)).join(''));
  for (const t of tps) {
    const cells = sls.map((s) => usd(stats(simulate(candles, cross, { ...base, tpPct: t, slPct: s, sides: ['long', 'short'] }).trades, notional).net).padStart(11));
    console.log(`  ${(t + '% ').padStart(7)}|` + cells.join(''));
  }
  console.log(`\n--- TP × SL GRID: win% / PF ---`);
  console.log('   TP\\SL |' + sls.map((s) => `${s}%`.padStart(13)).join(''));
  for (const t of tps) {
    const cells = sls.map((s) => {
      const st = stats(simulate(candles, cross, { ...base, tpPct: t, slPct: s, sides: ['long', 'short'] }).trades, notional);
      return `${fmt((st.wins / st.n) * 100, 0)}%/${fmt(st.pf)}`.padStart(13);
    });
    console.log(`  ${(t + '% ').padStart(7)}|` + cells.join(''));
  }

  // ---- per year (both sides) ----
  const bothTrades = results[0]![2];
  console.log(`\n--- PER YEAR (both sides, entry year) ---`);
  console.log('  year |  n  | win%  | TP | SL |   NET $   |  PF');
  for (const y of [...new Set(bothTrades.map((t) => t.year))].sort()) {
    const yt = bothTrades.filter((t) => t.year === y);
    const s = stats(yt, notional);
    console.log(
      `  ${y} | ${String(s.n).padStart(3)} | ${(fmt((s.wins / s.n) * 100, 1) + '%').padStart(5)} | ${String(s.tp).padStart(2)} | ${String(s.sl).padStart(2)} | ` +
        `${usd(s.net).padStart(9)} | ${fmt(s.pf)}`,
    );
  }

  // ---- fee sensitivity ----
  console.log(`\n--- FEE SENSITIVITY (both sides) ---`);
  for (const fv of [0, 0.02, 0.05, 0.06, 0.1]) {
    const s = stats(simulate(candles, cross, { ...base, sides: ['long', 'short'], feePct: fv }).trades, notional);
    console.log(`  fee ${fmt(fv, 2)}%/side → NET ${usd(s.net).padStart(10)} · PF ${fmt(s.pf)} · comp $${fmt(s.compounded)}`);
  }

  const bh = (candles[candles.length - 1]!.close - candles[0]!.close) / candles[0]!.close;
  console.log(`\n--- REFERENCE ---\n  ${symbol} buy & hold: ${pct(bh * 100)}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
