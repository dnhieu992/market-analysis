'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import type { AssetSummary } from '@web/shared/api/types';
import { buildAllocationItems, buildSlices } from '@web/widgets/my-asset/allocation-pie';

/** Same palette, in the same order, as `HoldingsAllocationChart` — the two donuts sit on the
 *  same page, so a coin must not change colour between them. */
const COLORS = [
  '#60a5fa', '#34d399', '#fbbf24', '#f87171',
  '#a78bfa', '#22d3ee', '#fb923c', '#818cf8',
  '#f472b6', '#4ade80', '#facc15', '#38bdf8',
];

type Props = Readonly<{
  summary: AssetSummary;
}>;

function formatUsd(value: number, decimals = 2): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: decimals }).format(value);
}

/**
 * `buildAllocationItems` labels its generated rows for /my-asset, which is a Vietnamese page.
 * This card sits next to the English net-worth card, so the two generated labels are swapped
 * here rather than at the source — /my-asset keeps its own wording.
 */
function toEnglish(label: string, key: string): string {
  if (key === 'available') return 'Available USDT';
  if (key === 'coin:other') return label.replace('Coin khác', 'Other Coins');
  return label;
}

/**
 * The /my-asset headline and its allocation donut, mirrored onto the overview so the whole book
 * is visible without leaving the dashboard. Deliberately built from the same `ps-*` markup,
 * palette and wording as `HoldingsAllocationChart` below it so the two read as one card family;
 * only the columns are flipped — donut left, total right.
 *
 * The figures are derived exactly as on /my-asset — current value measured against net deposits —
 * so both pages always agree.
 */
export function AssetSummaryCard({ summary }: Props) {
  const slices = useMemo(() => {
    const items = buildAllocationItems(summary).map((item) => ({
      ...item,
      label: toEnglish(item.label, item.key),
    }));

    // `buildSlices` carries the ordering, the negative-value exclusion and the overflow fold;
    // only its palette is dropped, in favour of the sibling card's.
    return buildSlices(items).slices.map((slice, i) => ({
      ...slice,
      name: slice.name.startsWith('Khác') ? 'Other' : slice.name,
      color: COLORS[i % COLORS.length] as string,
    }));
  }, [summary]);

  const { totalDepositedUsdt, totalWithdrawnUsdt, currentValueUsdt, available } = summary;
  const netFlow = totalDepositedUsdt - totalWithdrawnUsdt;
  const pnl = currentValueUsdt - netFlow;
  const pnlPct = netFlow > 0 ? (pnl / netFlow) * 100 : 0;
  const isPositive = pnl >= 0;

  const deployedValue = available.deployed.reduce((sum, b) => sum + b.currentValueUsdt, 0);

  return (
    <section className="ps-card ps-card--asset">
      <div className="ps-top-section">
        <div className="ps-left">
          <h3 className="ps-section-title">Capital Allocation</h3>
          <div className="ps-donut-row">
            <div className="ps-chart-wrap">
              {slices.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={slices}
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={72}
                      dataKey="value"
                      strokeWidth={2}
                      stroke="var(--background-elevated, #1a1a2e)"
                      isAnimationActive={false}
                    >
                      {slices.map((slice, i) => (
                        <Cell key={slice.name} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => [formatUsd(Number(v)), '']} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <span className="tt-muted" style={{ fontSize: '0.8rem' }}>No data</span>
              )}
            </div>

            <div className="ps-legend">
              {slices.map((slice) => (
                <div key={slice.name} className="ps-legend-item">
                  <span className="ps-legend-dot" style={{ background: slice.color }} />
                  <span className="ps-legend-name">{slice.name}</span>
                  <span className="ps-legend-pct">{Math.round(slice.pct)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="ps-right">
          <p className="ps-eyebrow">Total Assets · All Accounts</p>
          <h2 className="ps-net-worth">{formatUsd(currentValueUsdt)}</h2>

          <div className="ps-badges">
            <span className={`ps-badge ${isPositive ? 'ps-badge--up' : 'ps-badge--down'}`}>
              {isPositive ? '▲' : '▼'} {isPositive ? '+' : ''}{formatUsd(pnl)}
            </span>
            <span className={`ps-badge ${isPositive ? 'ps-badge--up' : 'ps-badge--down'}`}>
              {isPositive ? '+' : ''}{pnlPct.toFixed(2)}% · all-time
            </span>
          </div>

          <div className="ps-pnl-section">
            <p className="ps-eyebrow">Net Deposits</p>
            <Link href="/my-asset" className="ps-pnl-link">
              <p className="ps-pnl-value">{formatUsd(netFlow)}</p>
            </Link>
          </div>

          <div className="ps-stat-row">
            <div className="ps-stat-box">
              <span className="ps-stat-label">Accounts</span>
              <span className="ps-stat-value">{summary.categories.length}</span>
            </div>
            <div className="ps-stat-box">
              <span className="ps-stat-label">Available</span>
              <span className="ps-stat-value">{formatUsd(available.availableUsdt, 0)}</span>
            </div>
            <div className="ps-stat-box">
              <span className="ps-stat-label">Deployed</span>
              <span className="ps-stat-value">{formatUsd(deployedValue, 0)}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
