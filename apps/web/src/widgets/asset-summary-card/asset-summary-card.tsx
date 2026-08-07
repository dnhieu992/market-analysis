'use client';

import { useEffect, useMemo, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import { createApiClient } from '@web/shared/api/client';
import type { AssetSummary, AssetTransactionType } from '@web/shared/api/types';
import { buildAllocationItems, buildSlices } from '@web/widgets/my-asset/allocation-pie';
import { AssetTransactionDialog } from '@web/widgets/my-asset/asset-transaction-dialog';
import { AssetHistoryDialog } from '@web/widgets/my-asset/asset-history-dialog';
import { AddCategoryDialog } from '@web/widgets/my-asset/add-category-dialog';

const apiClient = createApiClient();

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

/** Which overlay is open. The ledger actions map 1:1 onto `AssetTransactionType`. */
type OpenDialog = AssetTransactionType | 'HISTORY' | 'CATEGORY' | null;

function formatUsd(value: number, decimals = 2): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: decimals }).format(value);
}

/**
 * `buildAllocationItems` labels its generated rows for /my-asset, which is a Vietnamese page.
 * This card sits next to the English net-worth card, so the two generated labels are swapped
 * here rather than at the source — /my-asset keeps its own wording.
 */
function toEnglish(label: string, key: string): string {
  // Plain "USDT", so the cash row reads as one more ticker alongside BTC and ETH.
  if (key === 'available') return 'USDT';
  if (key === 'coin:other') return label.replace('Coin khác', 'Other Coins');
  return label;
}

/**
 * The /my-asset headline and its allocation donut, mirrored onto the overview so the whole book
 * is visible without leaving the dashboard. Deliberately built from the same `ps-*` markup,
 * palette, column split and wording as `HoldingsAllocationChart` below it — total left, donut
 * right — so the two read as one card family.
 *
 * With /my-asset retired this card is also the only entry point to the ledger: Deposit / Withdraw /
 * Transfer / History open the same dialogs that page used, and every mutation re-pulls the
 * summary into local state so the headline and the donut move together.
 */
export function AssetSummaryCard({ summary: serverSummary }: Props) {
  const [summary, setSummary] = useState(serverSummary);
  const [dialog, setDialog] = useState<OpenDialog>(null);

  // The overview refreshes its server component every 15s; adopt each new summary so the card is
  // live. Local state stays because a mutation must land immediately, without waiting for the
  // next tick — whichever arrives last wins, and both come from the same endpoint.
  useEffect(() => {
    setSummary(serverSummary);
  }, [serverSummary]);

  const slices = useMemo(() => {
    const items = buildAllocationItems(summary).map((item) => ({
      ...item,
      label: toEnglish(item.label, item.key),
    }));

    // `buildSlices` keeps the item order — USDT, BTC, ETH, the deployed accounts, then the
    // leftover coins — and carries the negative-value exclusion and the overflow fold; only
    // its palette is dropped, in favour of the sibling card's.
    return buildSlices(items).slices.map((slice, i) => ({
      ...slice,
      name: slice.name.startsWith('Khác') ? 'Other' : slice.name,
      color: COLORS[i % COLORS.length] as string,
    }));
  }, [summary]);

  const { totalDepositedUsdt, totalWithdrawnUsdt, currentValueUsdt } = summary;
  const netFlow = totalDepositedUsdt - totalWithdrawnUsdt;
  const pnl = currentValueUsdt - netFlow;
  const pnlPct = netFlow > 0 ? (pnl / netFlow) * 100 : 0;
  const isPositive = pnl >= 0;

  async function refresh() {
    setSummary(await apiClient.fetchAssetSummary());
  }

  return (
    <section className="ps-card">
      <div className="ps-top-section">
        <div className="ps-left">
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
            <p className="ps-pnl-value">{formatUsd(netFlow)}</p>
          </div>

          <div className="ps-actions">
            <button type="button" className="btn btn--primary" onClick={() => setDialog('DEPOSIT')}>
              Deposit
            </button>
            <button type="button" className="btn btn--secondary" onClick={() => setDialog('WITHDRAW')}>
              Withdraw
            </button>
            <button type="button" className="btn btn--secondary" onClick={() => setDialog('TRANSFER')}>
              Transfer
            </button>
            <button type="button" className="btn btn--secondary" onClick={() => setDialog('HISTORY')}>
              History
            </button>
          </div>
        </div>

        <div className="ps-right">
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
                  {/* The amount rides in the name so the legend keeps the sibling
                      card's three-column rhythm instead of growing a fourth. */}
                  <span className="ps-legend-name">
                    {slice.name} ({formatUsd(slice.value, 0)})
                  </span>
                  <span className="ps-legend-pct">{Math.round(slice.pct)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {dialog === 'DEPOSIT' || dialog === 'WITHDRAW' || dialog === 'TRANSFER' ? (
        <AssetTransactionDialog
          type={dialog}
          categories={summary.categories}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null);
            await refresh();
          }}
        />
      ) : null}

      {dialog === 'HISTORY' ? (
        <AssetHistoryDialog
          transactions={summary.transactions}
          categories={summary.categories}
          onClose={() => setDialog(null)}
          onChanged={refresh}
          // The history dialog stays closed behind the category form; reopening it on save
          // puts the trader back where they were, with the new bucket already loaded.
          onAddCategory={() => setDialog('CATEGORY')}
        />
      ) : null}

      {dialog === 'CATEGORY' ? (
        <AddCategoryDialog
          onClose={() => setDialog('HISTORY')}
          onSaved={async () => {
            await refresh();
            setDialog('HISTORY');
          }}
        />
      ) : null}
    </section>
  );
}
