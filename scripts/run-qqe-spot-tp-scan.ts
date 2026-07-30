/**
 * SPOT take-profit scan for the QQE Signals arrows on the /bitget Setup-tab chart.
 *
 * Spot means LONG ONLY (you cannot short spot) and no liquidation, so this scan answers the
 * question "which TP level gives the best hit rate" with NO stop-loss: buy on a green ▲ arrow and
 * hold until the TP prints, however long that takes.
 *
 * Uses the live indicator `calculateQqe` from @app/core with the chart's real params
 * (QQE_PARAMS in apps/api/src/modules/bitget/setup-chart-renderer.ts): rsiPeriod 10, smoothing 4,
 * qqeFactor 3.2 — NOT calculateQqe's own 14/5/4.238 defaults.
 *
 * WHY win rate alone is not enough, and what this script prints instead:
 * with no stop-loss and unlimited holding time, the hit rate mechanically approaches 100% as the
 * TP gets small or the wait gets long — a 1% TP on a rising asset "wins" almost always. The real
 * costs are (a) how long capital sits locked and (b) how far underwater it goes first. So every TP
 * level is reported with hit rate AND bars-to-TP AND max adverse excursion (MAE).
 *
 * Right-censoring is handled explicitly: signals late in the data have not had time to reach TP.
 * Those are counted as "chưa chạm" and, separately, the scan reports a MATURE-ONLY view over
 * signals that had at least `matureBars` of forward data, so the hit rate is not flattered.
 *
 * Two accounting modes:
 *   INDEPENDENT — every ▲ arrow is its own trade (measures raw signal quality; overlapping
 *                 positions allowed, like repeated spot buys).
 *   SEQUENTIAL  — one position at a time; arrows during an open position are skipped
 *                 (what a single spot wallet actually does).
 *
 * Usage:
 *   TS_NODE_TRANSPILE_ONLY=1 pnpm exec ts-node --project apps/api/tsconfig.json \
 *     scripts/run-qqe-spot-tp-scan.ts [symbol] [days|YYYY-MM-DD] [interval] [feePctPerSide]
 */
import * as https from 'https';
import { calculateQqe } from '@app/core';

const QQE = { rsiPeriod: 10, smoothing: 4, qqeFactor: 3.2 } as const;
const BINANCE_HOST = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQ = 1000;

type Candle = { openTime: number; high: number; low: number; close: number };

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
      out.push({ openTime: k[0] as number, high: +(k[2] as string), low: +(k[3] as string), close: +(k[4] as string) });
    }
    if (batch.length < MAX_PER_REQ) break;
    cur = (batch[batch.length - 1]![0] as number) + 1;
  }
  return out;
}

const fmt = (n: number, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n: number, d = 2) => (n >= 0 ? '+' : '') + fmt(n, d) + '%';
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const quant = (a: number[], q: number) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]!;
};
const med = (a: number[]) => quant(a, 0.5);
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

/** One ▲ signal evaluated against one TP level, with no stop-loss. */
type Outcome = {
  entryIdx: number;
  entryTime: number;
  hit: boolean;
  bars: number; // bars to TP, or bars of data available if never hit
  mae: number; // most negative (low-entry)/entry seen before TP (or up to data end)
  markIfUnhit: number; // (lastClose-entry)/entry when never hit
  barsAvailable: number;
};

function evaluate(candles: Candle[], signalIdx: number[], tp: number): Outcome[] {
  const n = candles.length;
  const lastClose = candles[n - 1]!.close;
  const out: Outcome[] = [];
  for (const i of signalIdx) {
    const entry = candles[i]!.close;
    const tpPx = entry * (1 + tp);
    let hit = false;
    let bars = 0;
    let mae = 0;
    for (let j = i + 1; j < n; j++) {
      const dd = (candles[j]!.low - entry) / entry;
      if (dd < mae) mae = dd;
      if (candles[j]!.high >= tpPx) {
        hit = true;
        bars = j - i;
        break;
      }
    }
    const barsAvailable = n - 1 - i;
    out.push({
      entryIdx: i,
      entryTime: candles[i]!.openTime,
      hit,
      bars: hit ? bars : barsAvailable,
      mae,
      markIfUnhit: hit ? NaN : (lastClose - entry) / entry,
      barsAvailable,
    });
  }
  return out;
}

/** SEQUENTIAL: walk the signals in order, skipping any that fire while a position is still open. */
function sequentialIdx(candles: Candle[], signalIdx: number[], tp: number): number[] {
  const n = candles.length;
  const taken: number[] = [];
  let freeAt = -1;
  for (const i of signalIdx) {
    if (i < freeAt) continue;
    taken.push(i);
    const entry = candles[i]!.close;
    const tpPx = entry * (1 + tp);
    let exit = n; // still open at the end
    for (let j = i + 1; j < n; j++) {
      if (candles[j]!.high >= tpPx) {
        exit = j;
        break;
      }
    }
    freeAt = exit;
  }
  return taken;
}

function summarise(o: Outcome[], tp: number, feePct: number, barHours: number, matureBars: number) {
  const f = feePct / 100;
  const netWin = ((1 + tp) * (1 - f) * (1 - f) - 1) * 100;
  const hits = o.filter((x) => x.hit);
  const misses = o.filter((x) => !x.hit);
  // mature = had enough forward data that "never hit" is a real failure, not censoring
  const mature = o.filter((x) => x.hit || x.barsAvailable >= matureBars);
  const matureHits = mature.filter((x) => x.hit);
  const barsToTp = hits.map((x) => x.bars);
  const maeHits = hits.map((x) => x.mae * 100);
  return {
    n: o.length,
    hitRate: o.length ? (hits.length / o.length) * 100 : NaN,
    hits: hits.length,
    misses: misses.length,
    matureN: mature.length,
    matureHitRate: mature.length ? (matureHits.length / mature.length) * 100 : NaN,
    netWin,
    medBars: med(barsToTp),
    meanBars: mean(barsToTp),
    p90Bars: quant(barsToTp, 0.9),
    medDays: (med(barsToTp) * barHours) / 24,
    p90Days: (quant(barsToTp, 0.9) * barHours) / 24,
    maxDays: (Math.max(...barsToTp, 0) * barHours) / 24,
    medMae: med(maeHits),
    p90Mae: quant(maeHits, 0.1), // 10th percentile = deep end for negative numbers
    worstMae: Math.min(...maeHits, 0),
    missMarkMed: misses.length ? med(misses.map((x) => x.markIfUnhit * 100)) : NaN,
    missWorstMark: misses.length ? Math.min(...misses.map((x) => x.markIfUnhit * 100)) : NaN,
    barHours,
  };
}

async function main() {
  const a = process.argv.slice(2);
  const symbol = (a[0] ?? 'ETHUSDT').toUpperCase();
  const span = a[1] ?? '3200';
  const interval = a[2] ?? '4h';
  const feePct = Number(a[3] ?? 0.06);
  const barHours = interval === '4h' ? 4 : interval === '1h' ? 1 : interval === '1d' ? 24 : 4;
  const matureBars = Math.round((180 * 24) / barHours); // 180 days of forward data = "mature"

  const endMs = Date.now();
  const startMs = /^\d{4}-\d{2}-\d{2}$/.test(span) ? Date.parse(`${span}T00:00:00Z`) : endMs - Number(span) * 864e5;
  console.log(`\nFetching ${symbol} ${interval} from ${new Date(startMs).toISOString().slice(0, 10)}...`);
  const candles = await fetchKlines(symbol, interval, startMs, endMs);
  if (!candles.length) throw new Error('no candles');
  const { cross } = calculateQqe(
    candles.map((c) => c.close),
    QQE.rsiPeriod,
    QQE.smoothing,
    QQE.qqeFactor,
  );
  const longIdx: number[] = [];
  cross.forEach((c, i) => {
    if (c === 'long') longIdx.push(i);
  });

  console.log(`\n${'='.repeat(104)}`);
  console.log(`${symbol} · SPOT (long only, NO stop-loss) · QQE ▲ (${QQE.rsiPeriod},${QQE.smoothing},${QQE.qqeFactor}) · ${interval}`);
  console.log(`${'='.repeat(104)}`);
  console.log(`  data ${iso(candles[0]!.openTime)} → ${iso(candles[candles.length - 1]!.openTime)} · ${candles.length} bars · ${longIdx.length} ▲ signals`);
  console.log(`  fee ${feePct}%/side · hold until TP, no SL, no time limit`);
  console.log(`  "mature" = signal had ≥ ${matureBars} bars (180 days) of forward data, so a miss is a real failure not censoring`);

  const tps = [1, 1.5, 2, 3, 4, 5, 7, 10, 15, 20, 30, 50];

  for (const mode of ['INDEPENDENT', 'SEQUENTIAL'] as const) {
    console.log(`\n${'─'.repeat(104)}`);
    console.log(
      mode === 'INDEPENDENT'
        ? `MODE: INDEPENDENT — every ▲ is its own trade (raw signal quality, overlaps allowed)`
        : `MODE: SEQUENTIAL — one position at a time, ▲ during an open position is skipped (single spot wallet)`,
    );
    console.log(`${'─'.repeat(104)}`);
    console.log('    TP  | net win |  n  | HIT RATE | mature hit | chưa chạm | days to TP: med / p90 / max | MAE khi thắng: med / p10 / worst');
    console.log(`  ${'─'.repeat(102)}`);
    for (const t of tps) {
      const tp = t / 100;
      const idx = mode === 'INDEPENDENT' ? longIdx : sequentialIdx(candles, longIdx, tp);
      const s = summarise(evaluate(candles, idx, tp), tp, feePct, barHours, matureBars);
      console.log(
        `  ${(pct(t, 1) + ' ').padStart(6)}| ${pct(s.netWin, 2).padStart(7)} | ${String(s.n).padStart(3)} | ` +
          `${(fmt(s.hitRate, 1) + '%').padStart(8)} | ${(fmt(s.matureHitRate, 1) + '%').padStart(6)} (${String(s.matureN).padStart(3)}) | ` +
          `${String(s.misses).padStart(9)} | ${fmt(s.medDays, 1).padStart(6)} / ${fmt(s.p90Days, 1).padStart(6)} / ${fmt(s.maxDays, 0).padStart(4)} | ` +
          `${pct(s.medMae, 1).padStart(7)} / ${pct(s.p90Mae, 1).padStart(7)} / ${pct(s.worstMae, 1).padStart(7)}`,
      );
    }
  }

  // ---- what the unhit trades look like (sequential, a few key TP levels) ----
  console.log(`\n${'─'.repeat(104)}\nCÁC LỆNH CHƯA CHẠM TP (sequential) — đang lỗ bao nhiêu\n${'─'.repeat(104)}`);
  console.log('    TP  | chưa chạm | mark hiện tại: median / worst | entry gần nhất chưa chạm');
  for (const t of [2, 3, 5, 10, 20, 30]) {
    const tp = t / 100;
    const idx = sequentialIdx(candles, longIdx, tp);
    const o = evaluate(candles, idx, tp);
    const miss = o.filter((x) => !x.hit);
    const s = summarise(o, tp, feePct, barHours, matureBars);
    const oldest = miss.length ? iso(Math.min(...miss.map((x) => x.entryTime))) : '—';
    console.log(
      `  ${(pct(t, 1) + ' ').padStart(6)}| ${String(miss.length).padStart(9)} | ${pct(s.missMarkMed, 1).padStart(8)} / ${pct(s.missWorstMark, 1).padStart(8)}       | ${oldest}`,
    );
  }

  // ---- capital efficiency: how much of the time is capital deployed (sequential) ----
  console.log(`\n${'─'.repeat(104)}\nHIỆU SUẤT VỐN (sequential) — vốn bị khoá bao lâu, mỗi năm ăn được mấy lần TP\n${'─'.repeat(104)}`);
  const totalYears = ((candles[candles.length - 1]!.openTime - candles[0]!.openTime) / 864e5) / 365.25;
  console.log('    TP  | trades | TP hit | TP/năm | net win | lãi cộng dồn (size cố định) | compound $1000');
  for (const t of tps) {
    const tp = t / 100;
    const idx = sequentialIdx(candles, longIdx, tp);
    const o = evaluate(candles, idx, tp);
    const s = summarise(o, tp, feePct, barHours, matureBars);
    const hits = o.filter((x) => x.hit).length;
    const perYear = hits / totalYears;
    // fixed-size: every hit banks netWin%; unhit positions marked to market
    const fixedPnl = hits * s.netWin + o.filter((x) => !x.hit).reduce((acc, x) => acc + x.markIfUnhit * 100, 0);
    let eq = 1000;
    for (const x of o) {
      const r = x.hit ? s.netWin / 100 : (1 + x.markIfUnhit) * (1 - feePct / 100) ** 2 - 1;
      eq *= 1 + r;
    }
    console.log(
      `  ${(pct(t, 1) + ' ').padStart(6)}| ${String(o.length).padStart(6)} | ${String(hits).padStart(6)} | ${fmt(perYear, 1).padStart(6)} | ` +
        `${pct(s.netWin, 2).padStart(7)} | ${pct(fixedPnl, 1).padStart(9)} of one trade's size   | $${fmt(eq)}`,
    );
  }

  const bh = ((candles[candles.length - 1]!.close - candles[0]!.close) / candles[0]!.close) * 100;
  console.log(`\n--- REFERENCE ---\n  ${symbol} buy & hold: ${pct(bh)} over ${fmt(totalYears, 1)} years\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
