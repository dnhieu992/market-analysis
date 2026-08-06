'use client';

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { createApiClient } from '@web/shared/api/client';
import type { AssetCategory, AssetTransaction, AssetTransactionType } from '@web/shared/api/types';

const apiClient = createApiClient();

type Props = Readonly<{
  transactions: AssetTransaction[];
  categories: AssetCategory[];
  onClose: () => void;
  /** Called after a row is deleted, so the caller can re-pull the summary. */
  onChanged: () => void | Promise<void>;
  onAddCategory: () => void;
}>;

const TYPE_LABEL: Record<AssetTransactionType, string> = {
  DEPOSIT: 'Nạp',
  WITHDRAW: 'Rút',
  TRANSFER: 'Chuyển',
};

function formatUsdt(value: number): string {
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

/**
 * The ledger table that used to be the bottom half of /my-asset, now reachable from the
 * overview card's History button. It also carries "+ Thêm danh mục": with the page gone this
 * is the only place left to add a bucket, and a category is a ledger concern anyway.
 *
 * Portalled to `document.body` — the overview card sets `backdrop-filter`, which would
 * otherwise become the containing block for the fixed backdrop and trap it inside the card.
 */
export function AssetHistoryDialog({
  transactions,
  categories,
  onClose,
  onChanged,
  onAddCategory,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const labelById = useMemo(
    () => new Map(categories.map((c) => [c.id, c.label])),
    [categories],
  );

  async function removeTransaction(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await apiClient.deleteAssetTransaction(id);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Xoá giao dịch thất bại');
    } finally {
      setBusyId(null);
    }
  }

  return createPortal(
    <div className="dialog-backdrop" onClick={onClose}>
      {/* Wide: the ledger table carries seven columns. */}
      <div className="dialog dialog--wide" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">Lịch sử giao dịch</span>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="Đóng">
            ✕
          </button>
        </div>

        <div className="dialog-body">
          <div className="ma-panel-header">
            <p className="ma-hint">{transactions.length} giao dịch gần nhất</p>
            <button type="button" className="btn btn--secondary ma-btn-sm" onClick={onAddCategory}>
              + Thêm danh mục
            </button>
          </div>

          {error ? <p className="ma-error">{error}</p> : null}

          {transactions.length === 0 ? (
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
                  {transactions.map((tx) => (
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
        </div>
      </div>
    </div>,
    document.body,
  );
}
