/**
 * Shared shaping/aggregation for Bitget CLOSED positions
 * (`/api/v2/mix/position/history-position`). Used by the worker sync job and by
 * the API read endpoint so the raw→row mapping and the PnL summary math live in
 * one place.
 */

/** Raw row from Bitget history-position (only the fields we read; all strings). */
export type BitgetClosedRaw = {
  positionId?: string;
  symbol?: string;
  holdSide?: string;
  marginMode?: string;
  openAvgPrice?: string;
  closeAvgPrice?: string;
  openTotalPos?: string;
  netProfit?: string;
  pnl?: string;
  totalFunding?: string;
  openFee?: string;
  closeFee?: string;
  ctime?: string;
  utime?: string;
};

/** Normalized, DB-ready shape for one closed position. */
export type BitgetClosedNormalized = {
  positionId: string;
  symbol: string;
  holdSide: 'long' | 'short';
  marginMode: string;
  openAvgPrice: number;
  closeAvgPrice: number;
  openTotalPos: number;
  netProfit: number;
  pnl: number;
  totalFunding: number;
  openFee: number;
  closeFee: number;
  openedAt: Date;
  closedAt: Date;
};

const num = (v: string | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Map one raw Bitget row to the normalized shape, or `null` if it lacks the
 * identity fields we require (positionId + close time) — a half-formed row we
 * should skip rather than persist.
 */
export function normalizeBitgetClosed(raw: BitgetClosedRaw): BitgetClosedNormalized | null {
  const positionId = raw.positionId?.trim();
  const closeMs = num(raw.utime);
  if (!positionId || !raw.symbol || closeMs <= 0) return null;

  return {
    positionId,
    symbol: raw.symbol,
    holdSide: raw.holdSide === 'short' ? 'short' : 'long',
    marginMode: raw.marginMode ?? '',
    openAvgPrice: num(raw.openAvgPrice),
    closeAvgPrice: num(raw.closeAvgPrice),
    openTotalPos: num(raw.openTotalPos),
    netProfit: num(raw.netProfit),
    pnl: num(raw.pnl),
    totalFunding: num(raw.totalFunding),
    openFee: num(raw.openFee),
    closeFee: num(raw.closeFee),
    openedAt: new Date(num(raw.ctime) || closeMs),
    closedAt: new Date(closeMs),
  };
}

/** The minimum a trade needs for the summary — satisfied by both the normalized
 *  shape and the persisted DB row. */
export type ClosedTradeLike = {
  symbol: string;
  netProfit: number;
  openAvgPrice: number;
  openTotalPos: number;
};

export type BitgetClosedSummary = {
  trades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  totalNetProfit: number;
  avgNetProfit: number;
  bestNetProfit: number;
  worstNetProfit: number;
  totalVolumeUsd: number;
};

/** Aggregate realized-PnL stats over a set of closed trades. */
export function summarizeBitgetClosed(rows: ClosedTradeLike[]): BitgetClosedSummary {
  const trades = rows.length;
  let wins = 0;
  let losses = 0;
  let totalNetProfit = 0;
  let bestNetProfit = 0;
  let worstNetProfit = 0;
  let totalVolumeUsd = 0;

  for (const r of rows) {
    totalNetProfit += r.netProfit;
    if (r.netProfit > 0) wins++;
    else if (r.netProfit < 0) losses++;
    if (r.netProfit > bestNetProfit) bestNetProfit = r.netProfit;
    if (r.netProfit < worstNetProfit) worstNetProfit = r.netProfit;
    totalVolumeUsd += Math.abs(r.openAvgPrice * r.openTotalPos);
  }

  const decided = wins + losses;
  return {
    trades,
    wins,
    losses,
    winRatePct: decided > 0 ? (wins / decided) * 100 : 0,
    totalNetProfit,
    avgNetProfit: trades > 0 ? totalNetProfit / trades : 0,
    bestNetProfit,
    worstNetProfit,
    totalVolumeUsd,
  };
}
