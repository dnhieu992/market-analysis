'use client';

import { useState } from 'react';

import { createApiClient } from '@web/shared/api/client';

const apiClient = createApiClient();

type Props = Readonly<{
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}>;

/** "Binance Spot" → "binance-spot". The API validates the same shape server-side. */
function slugify(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

export function AddCategoryDialog({ onClose, onSaved }: Props) {
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const key = slugify(label);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!key) {
      setError('Tên danh mục phải chứa ít nhất một chữ cái hoặc số');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await apiClient.createAssetCategory({ key, label: label.trim() });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Thêm danh mục thất bại');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog dialog--compact" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">Thêm danh mục</span>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="Đóng">
            ✕
          </button>
        </div>
        <form className="dialog-body ma-form" onSubmit={submit}>
          <label className="trade-field">
            <span>Tên danh mục</span>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ví dụ: Binance"
              maxLength={60}
              autoFocus
              required
            />
          </label>
          <p className="ma-hint">Mã danh mục: {key || '—'}</p>

          {error ? <p className="ma-error">{error}</p> : null}

          <div className="dialog-confirm-actions">
            <button type="button" className="btn btn--secondary" onClick={onClose}>
              Huỷ
            </button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? 'Đang lưu…' : 'Thêm'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
