import type { StrategyPaperTradePathData } from '@app/db';

/**
 * Minute-by-minute path of a filled scalping-skill trade and the time-stop study built on it.
 * The engine itself has no time stop; this only records what would have happened with one.
 */

export const PATH_MAX_MINUTES = 720;
/** Time stops the report compares (minutes after the fill); null = no time stop (current engine). */
export const TIME_STOP_CANDIDATES: Array<number | null> = [10, 15, 20, 30, 45, 60, 90, 120, 180, 240, null];
/** Trades wanted before the report's suggestion is worth acting on. */
export const TIME_STOP_TARGET_TRADES = 100;

const MINUTE = 60_000;
const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

export type PathBar = { t: number; closeT: number; high: number; low: number; close: number };

export type PathTrade = {
  entryPrice: number;
  initialStopLoss: number;
  direction: string;
  orderType: string | null;
  /** Fill moment: the fill candle's open for LIMIT/STOP, the accept moment for MARKET. */
  openedAt: Date;
  tp1HitAt: Date | null;
  /** Exit candle close (closedAt) once the trade is closed. */
  exitAt: Date | null;
};

export function emptyPath(t: PathTrade): StrategyPaperTradePathData | null {
  const risk = Math.abs(t.entryPrice - t.initialStopLoss);
  if (!(risk > 0)) return null;
  return {
    entryPrice: t.entryPrice,
    risk,
    direction: t.direction,
    closeR: [],
    mfeR: 0,
    maeR: 0,
    mfeMin: null,
    maeMin: null,
    tp1Min: null,
    exitMin: null,
  };
}

/**
 * Appends whole 1m candles to the path. Minute m = the close of the m-th whole candle after the
 * fill. Candles already logged are skipped, so the same bars can be fed again safely.
 */
export function extendPath(path: StrategyPaperTradePathData, t: PathTrade, bars: PathBar[]): StrategyPaperTradePathData {
  const p: StrategyPaperTradePathData = {
    entryPrice: path.entryPrice,
    risk: path.risk,
    direction: path.direction,
    closeR: [...path.closeR],
    mfeR: path.mfeR,
    maeR: path.maeR,
    mfeMin: path.mfeMin,
    maeMin: path.maeMin,
    tp1Min: path.tp1Min,
    exitMin: path.exitMin,
  };
  if (p.exitMin != null) return p;
  const dir = t.direction === 'SHORT' ? -1 : 1;
  const r = (price: number) => ((price - p.entryPrice) * dir) / p.risk;
  // A LIMIT/STOP fills inside its candle (openedAt = that candle's open): minute 1 is that candle,
  // but its range before the fill doesn't count. A MARKET fill starts at the next whole candle.
  const partialFirst = t.orderType !== 'MARKET';
  const base = partialFirst ? t.openedAt.getTime() : Math.ceil(t.openedAt.getTime() / MINUTE) * MINUTE;

  for (const b of bars) {
    if (b.t < base) continue;
    const minute = Math.round((b.t - base) / MINUTE) + 1;
    if (minute <= p.closeR.length) continue;

    const partial = partialFirst && minute === 1;
    const best = partial ? r(b.close) : r(dir === 1 ? b.high : b.low);
    const worst = partial ? r(b.close) : r(dir === 1 ? b.low : b.high);
    if (best > p.mfeR) { p.mfeR = round(best); p.mfeMin = minute; }
    if (worst < p.maeR) { p.maeR = round(worst); p.maeMin = minute; }

    if (t.exitAt && b.closeT >= t.exitAt.getTime() - 1) {
      p.exitMin = minute;
      break;
    }
    if (t.tp1HitAt && p.tp1Min == null && b.closeT >= t.tp1HitAt.getTime() - 1) p.tp1Min = minute;
    if (p.closeR.length >= PATH_MAX_MINUTES) continue;
    // Binance has no gaps in 1m data, but keep minutes aligned if one ever happens.
    while (p.closeR.length < minute - 1) p.closeR.push(p.closeR[p.closeR.length - 1] ?? 0);
    p.closeR.push(round(r(b.close)));
  }
  return p;
}

// ── Report ──────────────────────────────────────────────────────────────────

export type ClosedTradeForStudy = {
  id: string;
  rMultiple: number;
  feePct: number;
  path: StrategyPaperTradePathData;
};

export type TimeStopRow = {
  minutes: number | null;
  trades: number;
  /** Trades that would have been closed by the time stop (no TP1 / exit before it). */
  stopped: number;
  totalR: number;
  avgR: number;
  winRate: number;
  /** totalR minus the no-time-stop totalR. */
  deltaR: number;
};

/**
 * R of one trade under a time stop of `minutes`: unchanged if it exited or hit TP1 by then,
 * otherwise closed at that minute's close (net of fees, like the engine's PnL).
 */
export function rWithTimeStop(t: ClosedTradeForStudy, minutes: number | null): { r: number; stopped: boolean } {
  const p = t.path;
  if (minutes == null || p.exitMin == null) return { r: t.rMultiple, stopped: false };
  if (p.exitMin <= minutes || (p.tp1Min != null && p.tp1Min <= minutes)) return { r: t.rMultiple, stopped: false };
  const gross = p.closeR[minutes - 1];
  if (gross == null) return { r: t.rMultiple, stopped: false };
  const dir = p.direction === 'SHORT' ? -1 : 1;
  const exit = p.entryPrice + dir * gross * p.risk;
  const fees = ((p.entryPrice + exit) * t.feePct) / p.risk;
  return { r: gross - fees, stopped: true };
}

const median = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export function buildTimeStopReport(trades: ClosedTradeForStudy[]) {
  const base = trades.reduce((a, t) => a + t.rMultiple, 0);
  const rows: TimeStopRow[] = TIME_STOP_CANDIDATES.map((minutes) => {
    const rs = trades.map((t) => rWithTimeStop(t, minutes));
    const totalR = rs.reduce((a, x) => a + x.r, 0);
    return {
      minutes,
      trades: trades.length,
      stopped: rs.filter((x) => x.stopped).length,
      totalR: round(totalR, 2),
      avgR: trades.length ? round(totalR / trades.length, 3) : 0,
      winRate: trades.length ? round(rs.filter((x) => x.r > 0).length / trades.length, 3) : 0,
      deltaR: round(totalR - base, 2),
    };
  });
  const best = trades.length ? rows.reduce((a, b) => (b.totalR > a.totalR ? b : a)) : null;

  const paths = trades.map((t) => t.path);
  const winners = trades.filter((t) => t.rMultiple > 0).map((t) => t.path);
  const losers = trades.filter((t) => t.rMultiple <= 0).map((t) => t.path);
  const mins = (ps: typeof paths, k: 'tp1Min' | 'exitMin' | 'mfeMin') => ps.map((p) => p[k]).filter((x): x is number => x != null);

  return {
    sample: trades.length,
    target: TIME_STOP_TARGET_TRADES,
    ready: trades.length >= TIME_STOP_TARGET_TRADES,
    rows,
    best: best && best.deltaR > 0 ? best.minutes : null,
    stats: {
      medianTp1Min: median(mins(paths, 'tp1Min')),
      medianExitMinWinners: median(mins(winners, 'exitMin')),
      medianExitMinLosers: median(mins(losers, 'exitMin')),
      medianMfeMin: median(mins(paths, 'mfeMin')),
      medianMfeR: median(paths.map((p) => p.mfeR)),
      medianMaeR: median(paths.map((p) => p.maeR)),
    },
  };
}

export type TimeStopReport = ReturnType<typeof buildTimeStopReport>;
