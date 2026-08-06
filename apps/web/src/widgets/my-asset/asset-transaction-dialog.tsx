'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';

import { createApiClient } from '@web/shared/api/client';
import type { AssetCategory, AssetTransactionType } from '@web/shared/api/types';

const apiClient = createApiClient();

type Props = Readonly<{
  type: AssetTransactionType;
  categories: AssetCategory[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}>;

const TITLE: Record<AssetTransactionType, string> = {
  DEPOSIT: 'Nạp tiền lên sàn',
  WITHDRAW: 'Rút tiền khỏi sàn',
  TRANSFER: 'Chuyển giữa các danh mục',
};

/** Local (not UTC) YYYY-MM-DD, so the date input opens on the trader's today. */
function todayLocalIso(): string {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

export function AssetTransactionDialog({ type, categories, onClose, onSaved }: Props) {
  const needsFrom = type !== 'DEPOSIT';
  const needsTo = type !== 'WITHDRAW';

  const [amount, setAmount] = useState('');
  const [fromId, setFromId] = useState(categories[0]?.id ?? '');
  // Default the transfer destination to a different bucket than the source, so the
  // common case is one click instead of two.
  const [toId, setToId] = useState(
    type === 'TRANSFER' ? categories[1]?.id ?? '' : categories[0]?.id ?? '',
  );
  const [note, setNote] = useState('');
  const [occurredAt, setOccurredAt] = useState(todayLocalIso());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const amountUsdt = Number(amount);
    if (!Number.isFinite(amountUsdt) || amountUsdt <= 0) {
      setError('Số tiền phải lớn hơn 0');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await apiClient.createAssetTransaction({
        type,
        amountUsdt,
        ...(needsFrom ? { fromCategoryId: fromId } : {}),
        ...(needsTo ? { toCategoryId: toId } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        // Date-only input → noon local, so a timezone shift can't move it a day.
        occurredAt: new Date(`${occurredAt}T12:00:00`).toISOString(),
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lưu giao dịch thất bại');
    } finally {
      setSaving(false);
    }
  }

  // Portalled: the overview card that opens this sets `backdrop-filter`, which would become
  // the containing block for the fixed backdrop and trap the dialog inside the card.
  return createPortal(
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog dialog--compact" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">{TITLE[type]}</span>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="Đóng">
            ✕
          </button>
        </div>
        <form className="dialog-body ma-form" onSubmit={submit}>
          <label className="trade-field">
            <span>Số tiền (USDT)</span>
            <input
              type="number"
              step="0.00000001"
              min="0"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              autoFocus
              required
            />
          </label>

          {needsFrom ? (
            <label className="trade-field">
              <span>{type === 'TRANSFER' ? 'Từ danh mục' : 'Danh mục rút'}</span>
              <select value={fromId} onChange={(e) => setFromId(e.target.value)} required>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {needsTo ? (
            <label className="trade-field">
              <span>{type === 'TRANSFER' ? 'Đến danh mục' : 'Danh mục nhận'}</span>
              <select value={toId} onChange={(e) => setToId(e.target.value)} required>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="trade-field">
            <span>Ngày</span>
            <input
              type="date"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              required
            />
          </label>

          <label className="trade-field">
            <span>Ghi chú</span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Tuỳ chọn"
              maxLength={500}
            />
          </label>

          {error ? <p className="ma-error">{error}</p> : null}

          <div className="dialog-confirm-actions">
            <button type="button" className="btn btn--secondary" onClick={onClose}>
              Huỷ
            </button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? 'Đang lưu…' : 'Lưu'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
