import { summarizeDeployed } from './deployed-buckets';
import type { AssetDeployedSource, AssetDeployedValue } from '@web/shared/api/types';

function bucket(
  key: string,
  capitalUsdt: number,
  pnlUsdt: number | null,
  source: AssetDeployedSource = 'exchange',
): AssetDeployedValue {
  return {
    key,
    label: key.toUpperCase(),
    balanceUsdt: capitalUsdt,
    capitalUsdt,
    currentValueUsdt: capitalUsdt + (pnlUsdt ?? 0),
    realizedPnlUsdt: pnlUsdt ?? 0,
    unrealizedPnlUsdt: 0,
    pnlUsdt,
    pnlPct: pnlUsdt != null && capitalUsdt > 0 ? (pnlUsdt / capitalUsdt) * 100 : null,
    source,
    pricedPartially: false,
  };
}

describe('summarizeDeployed', () => {
  it('sums capital, value and PnL across buckets', () => {
    const totals = summarizeDeployed([
      bucket('bitget', 100, 9.04),
      bucket('mexc', 50, 4.1),
      bucket('trading', 850, -20),
    ]);

    expect(totals.capitalUsdt).toBe(1000);
    expect(totals.currentValueUsdt).toBeCloseTo(993.14);
    expect(totals.pnlUsdt).toBeCloseTo(-6.86);
    expect(totals.pnlPct).toBeCloseTo(-0.686);
  });

  it('measures the return only against capital that could be valued', () => {
    // The unknown bucket's 900 must stay out of the denominator, otherwise a
    // +10% result on the measured 100 would be reported as +1%.
    const totals = summarizeDeployed([
      bucket('bitget', 100, 10),
      bucket('trading', 900, null, 'unknown'),
    ]);

    expect(totals.capitalUsdt).toBe(1000);
    expect(totals.pnlUsdt).toBe(10);
    expect(totals.pnlPct).toBeCloseTo(10);
  });

  it('reports no total PnL when nothing could be valued', () => {
    const totals = summarizeDeployed([
      bucket('bitget', 100, null, 'unknown'),
      bucket('mexc', 50, null, 'unknown'),
    ]);

    expect(totals.capitalUsdt).toBe(150);
    expect(totals.currentValueUsdt).toBe(150);
    expect(totals.pnlUsdt).toBeNull();
    expect(totals.pnlPct).toBeNull();
  });

  it('leaves the percentage undefined when no capital was committed', () => {
    const totals = summarizeDeployed([bucket('bitget', 0, 0)]);

    expect(totals.pnlUsdt).toBe(0);
    expect(totals.pnlPct).toBeNull();
  });

  it('returns zeros for an empty book', () => {
    expect(summarizeDeployed([])).toEqual({
      capitalUsdt: 0,
      currentValueUsdt: 0,
      pnlUsdt: null,
      pnlPct: null,
    });
  });
});
