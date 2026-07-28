/**
 * Shared shaping/aggregation for MEXC CLOSED positions
 * (`/api/v1/private/position/list/history_positions`). Mirrors `bitget-closed`
 * for the second exchange: the worker sync job and the API read endpoint both
 * go through this so the raw→row mapping lives in one place.
 *
 * Two shape differences vs Bitget matter here:
 *  - MEXC returns NUMBERS, not strings, and encodes direction as
 *    `positionType` (1 = long, 2 = short) / margin mode as `openType`
 *    (1 = isolated, 2 = cross).
 *  - Volumes are in CONTRACTS, so `contractSize` converts them to the base
 *    asset the dashboard shows. It is not part of the history row — the caller
 *    passes it from `/api/v1/contract/detail`, and 1 (already base-denominated)
 *    is the fallback when it is unknown.
 */

import { summarizeBitgetClosed, type BitgetClosedSummary, type ClosedTradeLike } from './bitget-closed';

/** Raw row from MEXC history_positions (only the fields we read). */
export type MexcClosedRaw = {
  positionId?: number | string;
  symbol?: string;
  /** 1 = long, 2 = short. */
  positionType?: number;
  /** 1 = isolated, 2 = cross. */
  openType?: number;
  /** 1 = holding, 2 = system-held, 3 = closed. */
  state?: number;
  /** Position size in CONTRACTS. */
  holdVol?: number;
  closeVol?: number;
  openAvgPrice?: number;
  closeAvgPrice?: number;
  /** Realized PnL, net of fees. */
  realised?: number;
  /** Close PnL excluding fees. */
  closeProfitLoss?: number;
  /** Accumulated trading fee across the position's fills. */
  totalFee?: number;
  fee?: number;
  /** Funding fee: positive = received, negative = paid. */
  holdFee?: number;
  leverage?: number;
  createTime?: number;
  updateTime?: number;
};

/** Normalized, DB-ready shape for one closed MEXC position. */
export type MexcClosedNormalized = {
  positionId: string;
  symbol: string;
  holdSide: 'long' | 'short';
  marginMode: string;
  openAvgPrice: number;
  closeAvgPrice: number;
  /** Position size in the BASE asset (contracts × contractSize). */
  openTotalPos: number;
  netProfit: number;
  pnl: number;
  totalFunding: number;
  openFee: number;
  closeFee: number;
  leverage: number | null;
  openedAt: Date;
  closedAt: Date;
};

const num = (v: number | string | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** MEXC's `openType` code → the margin-mode wording the dashboard uses. */
export function mexcMarginMode(openType: number | undefined): string {
  if (openType === 1) return 'isolated';
  if (openType === 2) return 'crossed';
  return '';
}

/**
 * Map one raw MEXC history row to the normalized shape, or `null` if it lacks
 * the identity fields we require (positionId + symbol + close time) — a
 * half-formed row we should skip rather than persist.
 *
 * `contractSize` converts MEXC's contract-denominated volume into the base
 * asset, so `openTotalPos × openAvgPrice` is a real USDT notional (the number
 * the PnL summary's volume column adds up).
 */
export function normalizeMexcClosed(raw: MexcClosedRaw, contractSize = 1): MexcClosedNormalized | null {
  const positionId = raw.positionId != null ? String(raw.positionId).trim() : '';
  const closeMs = num(raw.updateTime);
  if (!positionId || !raw.symbol || closeMs <= 0) return null;

  const size = contractSize > 0 ? contractSize : 1;
  // `holdVol` is 0 once the position is fully closed — `closeVol` is what was
  // actually traded out, so it is the reliable size for a closed row.
  const vol = num(raw.closeVol) || num(raw.holdVol);
  const leverage = num(raw.leverage);
  // MEXC reports ONE accumulated fee for the position, with no open/close split.
  // Putting it all on `closeFee` keeps `openFee + closeFee` (what the UI shows)
  // exact, rather than inventing a 50/50 split that would look precise but isn't.
  const totalFee = raw.totalFee != null ? num(raw.totalFee) : num(raw.fee);

  return {
    positionId,
    symbol: raw.symbol,
    holdSide: raw.positionType === 2 ? 'short' : 'long',
    marginMode: mexcMarginMode(raw.openType),
    openAvgPrice: num(raw.openAvgPrice),
    closeAvgPrice: num(raw.closeAvgPrice),
    openTotalPos: vol * size,
    netProfit: num(raw.realised),
    pnl: raw.closeProfitLoss != null ? num(raw.closeProfitLoss) : num(raw.realised),
    totalFunding: num(raw.holdFee),
    openFee: 0,
    closeFee: totalFee,
    leverage: leverage > 0 ? leverage : null,
    openedAt: new Date(num(raw.createTime) || closeMs),
    closedAt: new Date(closeMs),
  };
}

export type MexcClosedSummary = BitgetClosedSummary;

/**
 * Aggregate realized-PnL stats over a set of closed MEXC trades. The math is
 * exchange-agnostic (it only needs `ClosedTradeLike`), so this reuses the same
 * implementation the Bitget history tab runs on — one place to fix if the
 * win-rate/volume definitions ever change.
 */
export function summarizeMexcClosed(rows: ClosedTradeLike[]): MexcClosedSummary {
  return summarizeBitgetClosed(rows);
}
