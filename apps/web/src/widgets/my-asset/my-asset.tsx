'use client';

import { useMemo, useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { AssetSummary, AssetTransactionType } from '@web/shared/api/types';

import { AllocationPie, buildAllocationItems } from './allocation-pie';
import { AssetTransactionDialog } from './asset-transaction-dialog';
import { AddCategoryDialog } from './add-category-dialog';
import { DeployedBuckets } from './deployed-buckets';

const apiClient = createApiClient();

type MyAssetProps = Readonly<{
  initialSummary: AssetSummary;
}>;

export function formatUsdt(value: number): string {
  return `${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)} USDT`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

const TYPE_LABEL: Record<AssetTransactionType, string> = {
  DEPOSIT: 'Nạp',
  WITHDRAW: 'Rút',
  TRANSFER: 'Chuyển',
};

export function MyAsset({ initialSummary }: MyAssetProps) {
  const [summary, setSummary] = useState(initialSummary);
  const [dialog, setDialog] = useState<AssetTransactionType | null>(null);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const labelById = useMemo(
    () => new Map(summary.categories.map((c) => [c.id, c.label])),
    [summary.categories],
  );

  // Coins at market + available cash + each deployed account — the parts of the
  // hero's current value, which is what the donut divides up.
  const allocationItems = useMemo(() => buildAllocationItems(summary), [summary]);

  async function refresh() {
    setSummary(await apiClient.fetchAssetSummary());
  }

  async function removeTransaction(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await apiClient.deleteAssetTransaction(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Xoá giao dịch thất bại');
    } finally {
      setBusyId(null);
    }
  }

  const { totalDepositedUsdt, totalWithdrawnUsdt, currentValueUsdt, available } = summary;
  // Vốn ban đầu = everything put in that is still on the books, minus what came
  // back out. It is the yardstick the headline is measured against.
  const netFlow = totalDepositedUsdt - totalWithdrawnUsdt;
  // Headline PnL is the whole book: the spot result (/portfolio's "all-time
  // profit") plus what the deployed accounts — Bitget, MEXC, the manual trade
  // book — have made or lost on the capital sent to them. Derived from the
  // displayed figures so the number always reconciles with what is on screen.
  const pnl = currentValueUsdt - netFlow;
  const pnlPct = netFlow > 0 ? (pnl / netFlow) * 100 : 0;

  return (
    <main className="dashboard-shell">
      <section className="ma-hero panel">
        <div>
          <p className="metric-label">Tổng tài sản</p>
          {/* One number: what is actually left after profits and losses. The
              ledger figure and the per-book split live further down the page. */}
          <p className="ma-total">{formatUsdt(currentValueUsdt)}</p>
          <p className="ma-hero-detail">
            <span className={pnl < 0 ? 'ma-pnl is-negative' : 'ma-pnl'}>
              {pnl >= 0 ? '+' : ''}
              {pnlPct.toFixed(2)}% ({pnl >= 0 ? '+' : ''}
              {formatUsdt(pnl)})
            </span>{' '}
            so với vốn ban đầu {formatUsdt(netFlow)}
            {available.pricedPartially ? (
              <span className="ma-hint-inline"> · một số coin không có giá, tính theo giá vốn</span>
            ) : null}
          </p>
        </div>
        <div className="ma-hero-actions">
          <button type="button" className="btn btn--primary" onClick={() => setDialog('DEPOSIT')}>
            Nạp
          </button>
          <button type="button" className="btn btn--secondary" onClick={() => setDialog('WITHDRAW')}>
            Rút
          </button>
          <button type="button" className="btn btn--secondary" onClick={() => setDialog('TRANSFER')}>
            Chuyển
          </button>
        </div>
      </section>

      {error ? <p className="ma-error">{error}</p> : null}

      {/* Sits above the allocation donut on purpose: the donut answers "where is
          the money?", this answers "how is it doing?" — the more urgent question. */}
      <section className="panel ma-panel">
        <div className="ma-panel-header">
          <h2>Vốn triển khai</h2>
        </div>
        <DeployedBuckets buckets={available.deployed} />
      </section>

      <section className="panel ma-panel">
        <div className="ma-panel-header">
          <h2>Phân bổ danh mục</h2>
          <button
            type="button"
            className="btn btn--secondary ma-btn-sm"
            onClick={() => setCategoryDialogOpen(true)}
          >
            + Thêm danh mục
          </button>
        </div>

        {summary.categories.length === 0 ? (
          <p className="ma-empty">Chưa có danh mục nào.</p>
        ) : (
          <AllocationPie items={allocationItems} />
        )}
      </section>

      <section className="panel ma-panel">
        <div className="ma-panel-header">
          <h2>Lịch sử giao dịch</h2>
        </div>

        {summary.transactions.length === 0 ? (
          <p className="ma-empty">Chưa có giao dịch nào. Bấm Nạp để bắt đầu.</p>
        ) : (
          <div className="ma-table-wrap">
            <table className="ma-table">
              <thead>
                <tr>
                  <th>Ngày</th>
                  <th>Loại</th>
                  <th>Từ</th>
                  <th>Đến</th>
                  <th className="ma-num">Số tiền</th>
                  <th>Ghi chú</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {summary.transactions.map((tx) => (
                  <tr key={tx.id}>
                    <td>{formatDate(tx.occurredAt)}</td>
                    <td>
                      <span className={`ma-type ma-type--${tx.type.toLowerCase()}`}>
                        {TYPE_LABEL[tx.type]}
                      </span>
                    </td>
                    <td>{tx.fromCategoryId ? labelById.get(tx.fromCategoryId) ?? '—' : '—'}</td>
                    <td>{tx.toCategoryId ? labelById.get(tx.toCategoryId) ?? '—' : '—'}</td>
                    <td className="ma-num">{formatUsdt(tx.amountUsdt)}</td>
                    <td className="ma-note">{tx.note ?? ''}</td>
                    <td>
                      <button
                        type="button"
                        className="btn--icon btn--icon-danger"
                        data-tooltip="Xoá"
                        aria-label="Xoá giao dịch"
                        disabled={busyId === tx.id}
                        onClick={() => removeTransaction(tx.id)}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {dialog ? (
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

      {categoryDialogOpen ? (
        <AddCategoryDialog
          onClose={() => setCategoryDialogOpen(false)}
          onSaved={async () => {
            setCategoryDialogOpen(false);
            await refresh();
          }}
        />
      ) : null}
    </main>
  );
}
