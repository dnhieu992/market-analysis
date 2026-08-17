/**
 * Shared shaping/aggregation for OKX CLOSED positions
 * (`/api/v5/account/positions-history`). Mirrors `bitget-closed` / `mexc-closed`
 * for the third exchange: the worker sync job and the API read endpoint both go
 * through this so the raw→row mapping lives in one place.
 *
 * Three shape differences vs Bitget/MEXC matter here:
 *  - OKX returns every numeric field as a STRING (like Bitget) but names them
 *    `openAvgPx` / `closeAvgPx` / `cTime` / `uTime`.
 *  - Direction lives in `direction` ("long" | "short"). `posSide` is only
 *    meaningful in long/short position mode — in the default NET mode it is the
 *    literal `"net"`, so `direction` is the field to trust.
 *  - Volumes are in CONTRACTS, so `ctVal` (contract value, from
 *    `/api/v5/public/instruments`) converts them to the base asset the dashboard
 *    shows. 1 (already base-denominated) is the fallback when it is unknown.
 *
 * Fee signs follow OKX's own convention, which happens to match Bitget's: `fee`
 * and `fundingFee` are NEGATIVE when charged. They are stored as-is so the
 * history table shows what the exchange actually deducted.
 */

import { summarizeBitgetClosed, type BitgetClosedSummary, type ClosedTradeLike } from './bitget-closed';

/** Raw row from OKX positions-history (only the fields we read; all strings). */
export type OkxClosedRaw = {
  posId?: string;
  /** Instrument id on the wire, e.g. `BTC-USDT-SWAP`. */
  instId?: string;
  /** "long" | "short" — the real direction, valid in BOTH position modes. */
  direction?: string;
  /** "long" | "short" | "net" — only meaningful in long/short mode. */
  posSide?: string;
  /** "cross" | "isolated". */
  mgnMode?: string;
  /** Close type: 1 = partial, 2 = full, 3 = liquidation, 4 = partial liq, 5 = ADL. */
  type?: string;
  /** Largest position size held, in CONTRACTS. */
  openMaxPos?: string;
  /** Total size closed, in CONTRACTS. */
  closeTotalPos?: string;
  openAvgPx?: string;
  closeAvgPx?: string;
  /** Realized PnL EXCLUDING fees and funding. */
  pnl?: string;
  /** Realized PnL INCLUDING fees, funding and any liquidation penalty. */
  realizedPnl?: string;
  /** Accumulated trading fee — negative when charged. */
  fee?: string;
  /** Accumulated funding fee — negative when paid, positive when received. */
  fundingFee?: string;
  /** Liquidation penalty — negative when charged. */
  liqPenalty?: string;
  lever?: string;
  cTime?: string;
  uTime?: string;
};

/** Normalized, DB-ready shape for one closed OKX position. */
export type OkxClosedNormalized = {
  positionId: string;
  /** App symbol (`BTCUSDT`), not the wire `BTC-USDT-SWAP`. */
  symbol: string;
  holdSide: 'long' | 'short';
  marginMode: string;
  openAvgPrice: number;
  closeAvgPrice: number;
  /** Position size in the BASE asset (contracts × ctVal). */
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

const num = (v: string | number | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** OKX's `mgnMode` → the margin-mode wording the dashboard uses. */
export function okxMarginMode(mgnMode: string | undefined): string {
  if (mgnMode === 'isolated') return 'isolated';
  if (mgnMode === 'cross') return 'crossed';
  return '';
}

/** OKX instrument id (`BTC-USDT-SWAP`) → app symbol (`BTCUSDT`). */
export function fromOkxInstId(instId: string): string {
  const parts = instId.trim().toUpperCase().split('-');
  if (parts.length < 2) return instId.trim().toUpperCase();
  return `${parts[0]}${parts[1]}`;
}

/**
 * Map one raw OKX history row to the normalized shape, or `null` if it lacks the
 * identity fields we require (posId + instId + close time) — a half-formed row we
 * should skip rather than persist.
 *
 * `ctVal` converts OKX's contract-denominated volume into the base asset, so
 * `openTotalPos × openAvgPrice` is a real USDT notional (the number the PnL
 * summary's volume column adds up).
 */
export function normalizeOkxClosed(raw: OkxClosedRaw, ctVal = 1): OkxClosedNormalized | null {
  const positionId = raw.posId != null ? String(raw.posId).trim() : '';
  const closeMs = num(raw.uTime);
  if (!positionId || !raw.instId || closeMs <= 0) return null;

  const size = ctVal > 0 ? ctVal : 1;
  // `closeTotalPos` is what was actually traded out; `openMaxPos` is the fallback
  // for a row where OKX left the close volume blank.
  const vol = num(raw.closeTotalPos) || num(raw.openMaxPos);
  const leverage = num(raw.lever);
  // `direction` is valid in both net and long/short position mode; `posSide` is
  // the literal "net" under net mode, so it is only a fallback here.
  const side = (raw.direction || raw.posSide || '').toLowerCase();
  // OKX reports ONE accumulated fee for the position, with no open/close split.
  // Putting it all on `closeFee` keeps `openFee + closeFee` (what the UI shows)
  // exact, rather than inventing a 50/50 split that would look precise but isn't.
  const fee = num(raw.fee) + num(raw.liqPenalty);
  // `realizedPnl` already nets fees + funding + penalty; fall back to computing it
  // when OKX omits the field on an older row.
  const netProfit =
    raw.realizedPnl != null
      ? num(raw.realizedPnl)
      : num(raw.pnl) + fee + num(raw.fundingFee);

  return {
    positionId,
    symbol: fromOkxInstId(raw.instId),
    holdSide: side === 'short' ? 'short' : 'long',
    marginMode: okxMarginMode(raw.mgnMode),
    openAvgPrice: num(raw.openAvgPx),
    closeAvgPrice: num(raw.closeAvgPx),
    openTotalPos: vol * size,
    netProfit,
    pnl: num(raw.pnl),
    totalFunding: num(raw.fundingFee),
    openFee: 0,
    closeFee: fee,
    leverage: leverage > 0 ? leverage : null,
    openedAt: new Date(num(raw.cTime) || closeMs),
    closedAt: new Date(closeMs),
  };
}

export type OkxClosedSummary = BitgetClosedSummary;

/**
 * Aggregate realized-PnL stats over a set of closed OKX trades. The math is
 * exchange-agnostic (it only needs `ClosedTradeLike`), so this reuses the same
 * implementation the Bitget history tab runs on — one place to fix if the
 * win-rate/volume definitions ever change.
 */
export function summarizeOkxClosed(rows: ClosedTradeLike[]): OkxClosedSummary {
  return summarizeBitgetClosed(rows);
}
