'use client';

import { useMemo, useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { AssetSummary, AssetTransactionType } from '@web/shared/api/types';

import { AllocationPie } from './allocation-pie';
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

  const { totalUsdt, totalDepositedUsdt, totalWithdrawnUsdt, currentValueUsdt, available } = summary;
  // Everything the trader put in that is still on the books, minus what came back out.
  const netFlow = totalDepositedUsdt - totalWithdrawnUsdt;
  // Headline PnL is the whole spot result — banked plus on paper — the same
  // "all-time profit" /portfolio and /portfolio-pnl report.
  const pnl = available.totalSpotPnlUsdt;
  const pnlPct = totalUsdt > 0 ? (pnl / totalUsdt) * 100 : 0;

  return (
    <main className="dashboard-shell">
      <section className="ma-hero panel">
        <div>
          <p className="metric-label">Tổng tài sản</p>
          {/* The headline stays the ledger figure — it is what Nạp/Rút move and it
              must not drift with the market. Mark-to-market sits beside it. */}
          <p className="ma-total">{formatUsdt(totalUsdt)}</p>
          <p className="ma-hero-detail">
            Đã nạp {formatUsdt(totalDepositedUsdt)} · Đã rút {formatUsdt(totalWithdrawnUsdt)} · Ròng{' '}
            {formatUsdt(netFlow)}
          </p>
          <p className="ma-hero-detail">
            Giá trị hiện tại <strong>{formatUsdt(currentValueUsdt)}</strong>{' '}
            <span className={pnl < 0 ? 'ma-pnl is-negative' : 'ma-pnl'}>
              ({pnl >= 0 ? '+' : ''}
              {formatUsdt(pnl)} · {pnl >= 0 ? '+' : ''}
              {pnlPct.toFixed(2)}%)
            </span>
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

      {/* The arithmetic is spelled out rather than just its result — an "available"
          number the trader can't reconcile is one they won't trust. */}
      <section className="panel ma-panel ma-available">
        <div>
          <p className="metric-label">USDT khả dụng</p>
          <p className={`ma-available-value${available.availableUsdt < 0 ? ' is-negative' : ''}`}>
            {formatUsdt(available.availableUsdt)}
          </p>
          <p className="ma-hint">
            Tiền mặt thật — chưa tính lãi/lỗ chưa chốt{' '}
            <span className={available.unrealizedSpotPnlUsdt < 0 ? 'ma-pnl is-negative' : 'ma-pnl'}>
              ({available.unrealizedSpotPnlUsdt >= 0 ? '+' : ''}
              {formatUsdt(available.unrealizedSpotPnlUsdt)})
            </span>
          </p>
        </div>
        {/* Built up from the buckets that actually hold cash, rather than the total
            minus everything else — so wallet and any bucket added later appear by
            name instead of being buried inside a subtraction. */}
        <ul className="ma-available-breakdown">
          <li>
            <span>Spot được cấp</span>
            <span className="ma-num">{formatUsdt(available.spotAllocationUsdt)}</span>
          </li>
          <li>
            <span>− Vốn coin đang giữ</span>
            <span className="ma-num">{formatUsdt(available.spentOnSpotUsdt)}</span>
          </li>
          {/* Only the banked half. Unrealized PnL is real information but it is
              not spendable, so it is reported in the hero rather than netted off
              a number that answers "how much can I put into a trade now?". */}
          <li>
            <span>{available.realizedSpotPnlUsdt >= 0 ? '+' : '−'} Lãi spot đã chốt</span>
            <span className={`ma-num${available.realizedSpotPnlUsdt < 0 ? ' is-negative' : ''}`}>
              {formatUsdt(Math.abs(available.realizedSpotPnlUsdt))}
            </span>
          </li>
          {available.liquid.map((c) => (
            <li key={c.key}>
              <span>+ {c.label}</span>
              <span className="ma-num">{formatUsdt(c.balanceUsdt)}</span>
            </li>
          ))}
        </ul>
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
          <AllocationPie categories={summary.categories} />
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
