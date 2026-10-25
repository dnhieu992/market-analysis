/*
 * Position math behind the /bitget AI chat action cards: how much a margin buys,
 * where the average entry lands after a DCA add, what a TP is worth, and how much
 * of the capital a position ties up. Pure functions — the API sizes real orders
 * with the same formulas (margin × leverage ÷ price, floored to contract precision).
 */

export type PositionSide = 'long' | 'short';

/** Base-asset size `marginUsd × leverage` buys at `price`, floored to `volumePlace` decimals. */
export function sizeFromMargin(marginUsd: number, leverage: number, price: number, volumePlace = 8): number {
  if (!(marginUsd > 0) || !(leverage > 0) || !(price > 0)) return 0;
  const factor = 10 ** volumePlace;
  // The epsilon keeps 0.3 / 0.1-style float noise (2.9999999) from flooring a whole step away.
  return Math.floor(((marginUsd * leverage) / price) * factor + 1e-9) / factor;
}

/** Average entry after adding `addSize` at `addPrice` to `size` held at `avgEntry`. */
export function averageEntry(size: number, avgEntry: number, addSize: number, addPrice: number): number {
  const total = size + addSize;
  if (!(total > 0)) return 0;
  return (size * avgEntry + addSize * addPrice) / total;
}

/** Move from `entry` to `price` in the position's favour, in % (negative = against it). */
export function favourableMovePct(side: PositionSide, entry: number, price: number): number {
  if (!(entry > 0)) return 0;
  const move = ((price - entry) / entry) * 100;
  return side === 'long' ? move : -move;
}

/** Gross PnL (before fees/funding) of `size` entered at `entry` if closed at `price`, USD. */
export function pnlAt(side: PositionSide, entry: number, size: number, price: number): number {
  const diff = side === 'long' ? price - entry : entry - price;
  return diff * size;
}

/** Share of the capital a margin ties up, in % — null when the capital is unknown or 0. */
export function capitalSharePct(marginUsd: number, capitalUsd: number | null | undefined): number | null {
  if (capitalUsd == null || !(capitalUsd > 0) || !Number.isFinite(marginUsd)) return null;
  return (marginUsd / capitalUsd) * 100;
}

/**
 * Size to close for a partial exit of `pct` % of `totalSize`, floored to `volumePlace`.
 * 100 % (or more) returns the whole size so a full close never leaves dust behind.
 */
export function partialCloseSize(totalSize: number, pct: number, volumePlace = 8): number {
  if (!(totalSize > 0) || !(pct > 0)) return 0;
  if (pct >= 100) return totalSize;
  const factor = 10 ** volumePlace;
  return Math.floor(((totalSize * pct) / 100) * factor + 1e-9) / factor;
}
