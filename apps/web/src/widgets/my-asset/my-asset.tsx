'use client';

import { useMemo, useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { AssetSummary, AssetTransactionType } from '@web/shared/api/types';

import { AssetTransactionDialog } from './asset-transaction-dialog';
import { AddCategoryDialog } from './add-category-dialog';

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

  const { totalUsdt, totalDepositedUsdt, totalWithdrawnUsdt } = summary;
  // Everything the trader put in that is still on the books, minus what came back out.
  const netFlow = totalDepositedUsdt - totalWithdrawnUsdt;

  return (
    <main className="dashboard-shell">
      <section className="ma-hero panel">
        <div>
          <p className="metric-label">Tổng tài sản</p>
          <p className="ma-total">{formatUsdt(totalUsdt)}</p>
          <p className="ma-hero-detail">
            Đã nạp {formatUsdt(totalDepositedUsdt)} · Đã rút {formatUsdt(totalWithdrawnUsdt)} · Ròng{' '}
            {formatUsdt(netFlow)}
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
          <div className="ma-category-grid">
            {summary.categories.map((category) => {
              const share = totalUsdt > 0 ? (category.balanceUsdt / totalUsdt) * 100 : 0;
              return (
                <article key={category.id} className="ma-category-card">
                  <p className="ma-category-label">{category.label}</p>
                  <p className="ma-category-value">{formatUsdt(category.balanceUsdt)}</p>
                  <div className="ma-category-bar">
                    {/* A bucket can go negative if the trader logs a withdrawal it never
                        funded — clamp the bar so it never renders backwards. */}
                    <span style={{ width: `${Math.max(0, Math.min(100, share))}%` }} />
                  </div>
                  <p className="ma-category-share">{share.toFixed(1)}% tổng tài sản</p>
                </article>
              );
            })}
          </div>
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
