/**
 * Time-based intraday LONG backtest — Bitget Setup tab flow.
 *
 * Rule (every UTC day):
 *   - Entry : LONG at the OPEN of the entryHour:00 UTC 1h candle. NO leverage (1x),
 *             fixed $notional/trade.
 *   - TP    : +tpPct%. If any candle in the holding window [entryHour .. exitHour-1] trades up to
 *             entry x (1 + tp), exit at TP (limit fill assumed at the TP price).
 *   - No stop-loss. If TP is not reached, FORCE CLOSE at exitHour:00 UTC
 *             = the OPEN of the exitHour candle (= close of the exitHour-1 candle).
 *   - Exactly one trade per day; the position never spans days.
 *
 * Fees: feePct%/side, applied to both legs (round trip = 2x). Bitget Setup tab uses MARKET
 * orders -> measured taker fee is ~0.06%/side (see docs), so that is the default here.
 *
 * Reports: win-rate + payoff breakdown, per-year / per-month tables, drawdown on the compounded
 * curve, a TP x exit-hour grid, an ENTRY-HOUR scan (both at a fixed close time and at a fixed
 * hold length, so entry timing is separated from window length), and a fee sensitivity row.
 *
 * Usage:
 *   ts-node --project apps/api/tsconfig.json scripts/run-0000-long-tp-close-backtest.ts \
 *     [symbol] [days|YYYY-MM-DD] [tpPct] [exitHour] [feePctPerSide] [notional] [entryHour]
 *
 *   # ETH from 2025-01-01, TP +2%, force close 08:00 UTC, 0.06%/side, $1000/trade, entry 00:00
 *   ts-node ... scripts/run-0000-long-tp-close-backtest.ts ETHUSDT 2025-01-01 2 8 0.06 1000 0
 *
 * The 2nd arg accepts either a lookback in days or an absolute UTC start date.
 */
import * as https from 'https';

const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;
const INTERVAL = '1h';

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

type Trade = {
  openTime: number;
  year: number;
  month: string; // YYYY-MM
  entry: number;
  exit: number;
  grossRet: number;
  netRet: number;
  hitTP: boolean;
  hours: number;
};

function simulate(candles: Candle[], tpPct: number, exitHour: number, feePct: number, entryHour = 0): Trade[] {
  const f = feePct / 100;
  const tp = tpPct / 100;
  const trades: Trade[] = [];
  // Hours held if TP never fires; also bounds the safety valve below.
  const windowLen = ((exitHour - entryHour + 24) % 24) || 24;

  for (let i = 0; i < candles.length; i++) {
    const c0 = candles[i]!;
    if (c0.hour !== entryHour) continue;

    const entry = c0.open;
    const tpPx = entry * (1 + tp);
    let grossRet: number | null = null;
    let hitTP = false;
    let exitPx = 0;
    let hours = 0;

    for (let j = i; j < candles.length; j++) {
      const c = candles[j]!;
      // Force close at the OPEN of the exitHour candle (= close of exitHour-1).
      if (j > i && c.hour === exitHour) {
        exitPx = c.open;
        grossRet = (exitPx - entry) / entry;
        hours = j - i;
        break;
      }
      // TP is checked intra-candle on the high.
      if (c.high >= tpPx) {
        exitPx = tpPx;
        grossRet = tp;
        hitTP = true;
        hours = j - i + 1;
        break;
      }
      // Safety valve for data gaps: never hold past the intended window + 3 bars.
      if (j - i > windowLen + 3) {
        exitPx = c.close;
        grossRet = (exitPx - entry) / entry;
        hours = j - i;
        break;
      }
    }

    if (grossRet === null) continue; // incomplete window at the tail of the data
    const netRet = (1 + grossRet) * (1 - f) * (1 - f) - 1;
    trades.push({
      openTime: c0.openTime,
      year: c0.year,
      month: new Date(c0.openTime).toISOString().slice(0, 7),
      entry,
      exit: exitPx,
      grossRet,
      netRet,
      hitTP,
      hours,
    });
  }
  return trades;
}

type Stats = {
  trades: number;
  tpHits: number;
  wins: number; // net P&L > 0
  grossWins: number; // gross P&L > 0 (before fees)
  forced: number; // closed at exitHour instead of TP
  forcedWins: number; // forced closes that still ended net green
  net: number;
  avg: number;
  grossProfit: number; // sum of winning trades (net basis)
  grossLoss: number; // sum of losing trades, positive number
  avgWin: number;
  avgLoss: number; // positive number
  profitFactor: number;
  best: number;
  worst: number;
  maxWinStreak: number;
  maxLossStreak: number;
  compoundedEquity: number;
  maxDDPct: number;
};

function stats(trades: Trade[], notional: number): Stats {
  let net = 0;
  let wins = 0;
  let grossWins = 0;
  let tpHits = 0;
  let forced = 0;
  let forcedWins = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let best = -Infinity;
  let worst = Infinity;
  let lStreak = 0;
  let wStreak = 0;
  let maxLossStreak = 0;
  let maxWinStreak = 0;
  let eq = notional;
  let peak = notional;
  let maxDD = 0;

  for (const t of trades) {
    const pnl = notional * t.netRet;
    net += pnl;

    if (t.netRet > 0) {
      wins++;
      grossProfit += pnl;
      wStreak++;
      lStreak = 0;
      if (wStreak > maxWinStreak) maxWinStreak = wStreak;
    } else {
      grossLoss += -pnl;
      lStreak++;
      wStreak = 0;
      if (lStreak > maxLossStreak) maxLossStreak = lStreak;
    }
    if (t.grossRet > 0) grossWins++;
    if (t.hitTP) {
      tpHits++;
    } else {
      forced++;
      if (t.netRet > 0) forcedWins++;
    }
    if (pnl > best) best = pnl;
    if (pnl < worst) worst = pnl;

    eq *= 1 + t.netRet;
    if (eq > peak) peak = eq;
    const dd = ((peak - eq) / peak) * 100;
    if (dd > maxDD) maxDD = dd;
  }

  const losses = trades.length - wins;
  return {
    trades: trades.length,
    tpHits,
    wins,
    grossWins,
    forced,
    forcedWins,
    net,
    avg: trades.length ? net / trades.length : 0,
    grossProfit,
    grossLoss,
    avgWin: wins ? grossProfit / wins : 0,
    avgLoss: losses ? grossLoss / losses : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : Infinity,
    best: best === -Infinity ? 0 : best,
    worst: worst === Infinity ? 0 : worst,
    maxWinStreak,
    maxLossStreak,
    compoundedEquity: eq,
    maxDDPct: maxDD,
  };
}

async function main() {
  const [, , symA, spanA, tpA, ehA, feeA, notA, entA] = process.argv;
  const symbol = (symA ?? 'ETHUSDT').toUpperCase();
  const span = spanA ?? '365';
  const tpPct = Number(tpA ?? 2);
  const exitHour = Number(ehA ?? 8);
  const fee = Number(feeA ?? 0.06);
  const notional = Number(notA ?? 1000);
  const entryHour = Number(entA ?? 0);

  const endMs = Date.now();
  // 2nd arg is either an absolute UTC start date (YYYY-MM-DD) or a lookback in days.
  const startMs = /^\d{4}-\d{2}-\d{2}$/.test(span) ? Date.parse(`${span}T00:00:00Z`) : endMs - Number(span) * 864e5;

  console.log(`\nFetching ${symbol} ${INTERVAL} candles from ${new Date(startMs).toISOString().slice(0, 10)}...`);
  const candles = await fetchKlines(symbol, INTERVAL, startMs, endMs);
  if (candles.length === 0) throw new Error('no candles');
  const first = new Date(candles[0]!.openTime).toISOString().slice(0, 10);
  const last = new Date(candles[candles.length - 1]!.openTime).toISOString().slice(0, 10);

  console.log(
    `\n=== ${symbol} · LONG @ ${String(entryHour).padStart(2, '0')}:00 UTC · TP +${tpPct}% · force-close @ ${String(exitHour).padStart(2, '0')}:00 UTC · NO stop · NO leverage ===`,
  );
  console.log(`    data ${first} → ${last} (${candles.length} x ${INTERVAL} candles) · $${notional}/trade fixed · fee ${fee}%/side`);

  const trades = simulate(candles, tpPct, exitHour, fee, entryHour);
  const s = stats(trades, notional);

  const rate = (n: number) => fmt((n / s.trades) * 100, 1) + '%';

  console.log(`\n--- WIN RATE ---`);
  console.log(`  trades                    : ${s.trades}`);
  console.log(`  TP +${tpPct}% hit                : ${s.tpHits}  (${rate(s.tpHits)})   <- the "win" the rule aims for`);
  console.log(`  forced close @ ${String(exitHour).padStart(2, '0')}:00       : ${s.forced}  (${rate(s.forced)})`);
  console.log(`    ...of which still green : ${s.forcedWins}  (${fmt(s.forced ? (s.forcedWins / s.forced) * 100 : 0, 1)}% of forced)`);
  console.log(`  WIN RATE (net P&L > 0)    : ${s.wins} / ${s.trades} = ${rate(s.wins)}`);
  console.log(`  LOSS RATE (net P&L <= 0)  : ${s.trades - s.wins} / ${s.trades} = ${rate(s.trades - s.wins)}`);
  console.log(`  win rate before fees      : ${s.grossWins} / ${s.trades} = ${rate(s.grossWins)}`);

  console.log(`\n--- PAYOFF ---`);
  console.log(`  avg WIN  : ${usd(s.avgWin)} (${pct((s.avgWin / notional) * 100, 3)})`);
  console.log(`  avg LOSS : ${usd(-s.avgLoss)} (${pct((-s.avgLoss / notional) * 100, 3)})`);
  console.log(`  R:R realised (avgWin/avgLoss) : ${fmt(s.avgLoss ? s.avgWin / s.avgLoss : 0)}`);
  console.log(`  profit factor : ${fmt(s.profitFactor)}   <- needs > 1.00 to be profitable`);
  console.log(`  breakeven win rate required  : ${fmt((s.avgLoss / (s.avgWin + s.avgLoss)) * 100, 1)}%  (actual ${rate(s.wins)})`);

  console.log(`\n--- P&L ---`);
  console.log(`  NET P&L (fixed) : ${usd(s.net)}  →  ${pct((s.net / notional) * 100)} of one trade's size`);
  console.log(`  avg / trade     : ${usd(s.avg)} (${pct((s.avg / notional) * 100, 3)})`);
  console.log(`  gross profit / gross loss : ${usd(s.grossProfit)} / ${usd(-s.grossLoss)}`);
  console.log(`  best / worst    : ${usd(s.best)} / ${usd(s.worst)}`);
  console.log(`  max win streak / max loss streak : ${s.maxWinStreak} / ${s.maxLossStreak} days`);
  console.log(
    `  compounded $${notional} : $${fmt(s.compoundedEquity)} (${pct(((s.compoundedEquity - notional) / notional) * 100)}) · max DD ${fmt(s.maxDDPct, 1)}%`,
  );

  // ---- per-year ----
  console.log(`\n--- PER YEAR (fixed $${notional}/trade) ---`);
  console.log('  year | trades | TP hit | TP%  | win% |   NET $   | avg$/trade | PF');
  const years = [...new Set(trades.map((t) => t.year))].sort();
  for (const y of years) {
    const yt = trades.filter((t) => t.year === y);
    const ys = stats(yt, notional);
    console.log(
      `  ${y} | ${String(ys.trades).padStart(6)} | ${String(ys.tpHits).padStart(6)} | ` +
        `${(fmt((ys.tpHits / ys.trades) * 100, 0) + '%').padStart(4)} | ${(fmt((ys.wins / ys.trades) * 100, 0) + '%').padStart(4)} | ` +
        `${usd(ys.net).padStart(9)} | ${usd(ys.avg).padStart(10)} | ${fmt(ys.profitFactor)}`,
    );
  }

  // ---- per-month ----
  console.log(`\n--- PER MONTH (fixed $${notional}/trade) ---`);
  console.log('  month   | trades | TP hit | TP%  | win% |   NET $');
  const months = [...new Set(trades.map((t) => t.month))].sort();
  for (const m of months) {
    const mt = trades.filter((t) => t.month === m);
    const ms = stats(mt, notional);
    console.log(
      `  ${m} | ${String(ms.trades).padStart(6)} | ${String(ms.tpHits).padStart(6)} | ` +
        `${(fmt((ms.tpHits / ms.trades) * 100, 0) + '%').padStart(4)} | ${(fmt((ms.wins / ms.trades) * 100, 0) + '%').padStart(4)} | ` +
        `${usd(ms.net).padStart(9)}`,
    );
  }
  const greenMonths = months.filter((m) => stats(trades.filter((t) => t.month === m), notional).net > 0).length;
  console.log(`  → green months: ${greenMonths} / ${months.length} (${fmt((greenMonths / months.length) * 100, 0)}%)`);

  // ---- how long the winners take ----
  const tpTrades = trades.filter((t) => t.hitTP);
  if (tpTrades.length) {
    const hourBuckets = new Map<number, number>();
    for (const t of tpTrades) hourBuckets.set(t.hours, (hourBuckets.get(t.hours) ?? 0) + 1);
    const line = [...hourBuckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([h, n]) => `h${h}:${n}`)
      .join('  ');
    console.log(`\n--- TP hit in which hour of the window (h1 = 00:00-01:00 candle) ---\n  ${line}`);
  }

  // ---- sensitivity: TP x exit hour ----
  const tpGrid = [1, 1.5, 2, 2.5, 3];
  const ehGrid = [4, 6, 8, 10, 12, 16, 20, 24];

  console.log(`\n--- SENSITIVITY: NET $ (entry ${String(entryHour).padStart(2, '0')}:00, fee ${fee}%/side, fixed $${notional}/trade) ---`);
  console.log('   TP\\close |' + ehGrid.map((h) => `${String(h).padStart(2, '0')}:00`.padStart(9)).join(''));
  for (const tp of tpGrid) {
    const cells = ehGrid.map((eh) => usd(stats(simulate(candles, tp, eh % 24, fee, entryHour), notional).net).padStart(9));
    console.log(`  ${(pct(tp, 1) + ' ').padStart(9)}|` + cells.join(''));
  }

  console.log(`\n--- SENSITIVITY: WIN RATE (net > 0) / TP-hit rate ---`);
  console.log('   TP\\close |' + ehGrid.map((h) => `${String(h).padStart(2, '0')}:00`.padStart(12)).join(''));
  for (const tp of tpGrid) {
    const cells = ehGrid.map((eh) => {
      const r = stats(simulate(candles, tp, eh % 24, fee, entryHour), notional);
      return `${fmt((r.wins / r.trades) * 100, 0)}%/${fmt((r.tpHits / r.trades) * 100, 0)}%`.padStart(12);
    });
    console.log(`  ${(pct(tp, 1) + ' ').padStart(9)}|` + cells.join(''));
  }

  // ---- ENTRY HOUR SCAN ----
  const entGrid = [0, 1, 2, 3, 4, 5];
  const row = (r: Stats, label: string) =>
    `  ${label.padEnd(16)} | ${String(r.trades).padStart(6)} | ${(fmt((r.tpHits / r.trades) * 100, 1) + '%').padStart(6)} | ` +
    `${(fmt((r.wins / r.trades) * 100, 1) + '%').padStart(6)} | ${usd(r.net).padStart(10)} | ${usd(r.avg).padStart(8)} | ` +
    `${fmt(r.profitFactor).padStart(4)} | ${(fmt(r.maxDDPct, 1) + '%').padStart(6)} | $${fmt(r.compoundedEquity).padStart(8)}`;
  const header =
    '  entry            | trades | TP hit |  win%  |    NET $   | avg$/trd |  PF  | maxDD  | comp.$' +
    `\n  ${'-'.repeat(94)}`;

  // (A) entry varies, force-close FIXED at exitHour -> holding window shrinks as entry gets later
  console.log(
    `\n--- ENTRY HOUR SCAN (A): close FIXED @ ${String(exitHour).padStart(2, '0')}:00, TP +${tpPct}% · window shrinks as entry gets later ---`,
  );
  console.log(header);
  for (const eh of entGrid) {
    const r = stats(simulate(candles, tpPct, exitHour, fee, eh), notional);
    const hrs = ((exitHour - eh + 24) % 24) || 24;
    console.log(row(r, `${String(eh).padStart(2, '0')}:00 (${hrs}h)`));
  }

  // (B) entry varies, holding length FIXED -> isolates entry timing from window length
  const holdLen = ((exitHour - entryHour + 24) % 24) || 24;
  console.log(`\n--- ENTRY HOUR SCAN (B): hold FIXED ${holdLen}h from entry, TP +${tpPct}% · isolates entry timing ---`);
  console.log(header);
  for (const eh of entGrid) {
    const close = (eh + holdLen) % 24;
    const r = stats(simulate(candles, tpPct, close, fee, eh), notional);
    console.log(row(r, `${String(eh).padStart(2, '0')}:00→${String(close).padStart(2, '0')}:00`));
  }

  // (C) full entry x exit grid at the requested TP, to see if ANY pairing is positive
  console.log(`\n--- ENTRY x CLOSE GRID: NET $ (TP +${tpPct}%, fee ${fee}%/side) ---`);
  const ehFull = [2, 4, 6, 8, 10, 12, 16, 20];
  console.log(' entry\\close |' + ehFull.map((h) => `${String(h).padStart(2, '0')}:00`.padStart(10)).join(''));
  for (const en of entGrid) {
    const cells = ehFull.map((ex) => {
      if (ex <= en) return ''.padStart(10); // close must be after entry, same UTC day
      return usd(stats(simulate(candles, tpPct, ex, fee, en), notional).net).padStart(10);
    });
    console.log(`  ${(String(en).padStart(2, '0') + ':00 ').padStart(10)}|` + cells.join(''));
  }

  // (D) raw drift per entry hour: is any hour's next-8h move actually positive?
  console.log(`\n--- RAW ${holdLen}h DRIFT BY ENTRY HOUR (gross, no TP, no fee) ---`);
  console.log('  entry  |    n | mean ret  | median   | up%   | t-stat');
  for (const en of entGrid) {
    const rets: number[] = [];
    for (let i = 0; i < candles.length; i++) {
      if (candles[i]!.hour !== en) continue;
      const j = i + holdLen;
      if (j >= candles.length) break;
      rets.push((candles[j]!.open - candles[i]!.open) / candles[i]!.open);
    }
    const n = rets.length;
    const mean = rets.reduce((a, b) => a + b, 0) / n;
    const sorted = [...rets].sort((a, b) => a - b);
    const med = sorted[n >> 1]!;
    const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
    const up = rets.filter((r) => r > 0).length;
    console.log(
      `  ${String(en).padStart(2, '0')}:00  | ${String(n).padStart(4)} | ${pct(mean * 100, 4).padStart(9)} | ` +
        `${pct(med * 100, 4).padStart(8)} | ${(fmt((up / n) * 100, 1) + '%').padStart(5)} | ${fmt(mean / (sd / Math.sqrt(n)), 2).padStart(6)}`,
    );
  }

  // ---- fee sensitivity at the requested config ----
  console.log(`\n--- FEE SENSITIVITY (TP +${tpPct}%, close ${String(exitHour).padStart(2, '0')}:00) ---`);
  for (const f of [0, 0.02, 0.05, 0.06, 0.1]) {
    const r = stats(simulate(candles, tpPct, exitHour, f, entryHour), notional);
    console.log(
      `  fee ${fmt(f, 2)}%/side → NET ${usd(r.net).padStart(9)} · avg ${usd(r.avg)}/trade · compounded $${fmt(r.compoundedEquity)}`,
    );
  }

  // ---- buy & hold reference ----
  const bh = (candles[candles.length - 1]!.close - candles[0]!.open) / candles[0]!.open;
  console.log(`\n--- REFERENCE ---`);
  console.log(`  ${symbol} buy & hold over the same window: ${pct(bh * 100)}`);
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
