/** Pure math for the BTC DCA dip-bounce ladder strategy. No I/O. */

export type DcaLadderParams = {
  firstTierPct: number;
  numTiers: number;
  stepPct: number;
};

export type DcaFill = { price: number; usd: number };

export type DcaPosition = {
  avgCost: number;
  positionSize: number;
  capitalDeployed: number;
};

/** Percent below the frozen peak for each tier, e.g. [5, 6.5, 8, ...]. */
export function tierPctBelow(params: DcaLadderParams): number[] {
  const { firstTierPct, numTiers, stepPct } = params;
  return Array.from({ length: numTiers }, (_, i) => firstTierPct + i * stepPct);
}

/** Absolute limit-buy price for each tier given a frozen peak. */
export function tierPrices(peak: number, params: DcaLadderParams): number[] {
  return tierPctBelow(params).map((pct) => peak * (1 - pct / 100));
}

/**
 * Blend fills into a position. The buy fee is baked into avgCost: you spend
 * `usd` and receive `(usd/price) * (1 - feePct/100)` of base asset.
 */
export function computePosition(fills: DcaFill[], feePct: number): DcaPosition {
  if (fills.length === 0) return { avgCost: 0, positionSize: 0, capitalDeployed: 0 };
  const feeMul = 1 - feePct / 100;
  let positionSize = 0;
  let capitalDeployed = 0;
  for (const f of fills) {
    positionSize += (f.usd / f.price) * feeMul;
    capitalDeployed += f.usd;
  }
  return { avgCost: capitalDeployed / positionSize, positionSize, capitalDeployed };
}

/** Take-profit price target: avgCost grown by tpPct. */
export function computeTpPrice(avgCost: number, tpPct: number): number {
  return avgCost * (1 + tpPct / 100);
}

/** Net realized P&L when the whole position is sold at `sellPrice`. */
export function computeRealizedPnl(
  positionSize: number,
  _avgCost: number,
  sellPrice: number,
  capitalDeployed: number,
  feePct: number,
): number {
  const proceeds = positionSize * sellPrice * (1 - feePct / 100);
  return proceeds - capitalDeployed;
}

/** Compounded cycle budget. */
export function computeBudget(startCapital: number, realizedPnls: number[]): number {
  return startCapital + realizedPnls.reduce((a, b) => a + b, 0);
}
