'use client';

import { useEffect, useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { ChartSample, ImageRef } from '@web/shared/api/types';

import { ChartForm, EMPTY_FORM, toInput, type ChartFormValue } from './chart-form';
import s from './chart-lab.module.css';

const api = createApiClient();

/**
 * After an upload: one form per image (queue). Save = insert into the library as typed — no Claude.
 * Coin + timeframe carry over to the next image of the same batch.
 */
export function NewChartDialog({
  images,
  allTags,
  onSaved,
  onSkip,
  onClose,
}: {
  images: ImageRef[];
  allTags: string[];
  onSaved: (s: ChartSample) => void;
  onSkip: () => void;
  onClose: () => void;
}) {
  const current = images[0];
  const [form, setForm] = useState<ChartFormValue>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!current) return null;

  async function save() {
    if (!current) return;
    setSaving(true);
    setError(null);
    try {
      const created = await api.createChartSample(current, toInput(form));
      onSaved(created);
      // Next image of the batch: keep coin + timeframe, clear the rest.
      setForm({ ...EMPTY_FORM, symbol: form.symbol, interval: form.interval });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lưu thất bại');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className={s.backdrop} onClick={onClose} />
      <div className={s.modal} role="dialog" aria-label="Thêm chart">
        <div className={s.detailHead}>
          <div className={s.detailTitle}>
            Thêm chart vào kho{images.length > 1 ? <span className={s.muted}>· còn {images.length} ảnh</span> : null}
          </div>
          <button type="button" className={s.close} onClick={onClose} aria-label="Đóng">
            ✕
          </button>
        </div>
        <div className={s.modalGrid}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={s.bigImg} src={current.url} alt="chart mới" />
          <ChartForm value={form} onChange={setForm} allTags={allTags} />
        </div>
        {error && <p className={s.error}>{error}</p>}
        <div className={s.modalActions}>
          {images.length > 1 && (
            <button type="button" className={s.secondaryBtn} onClick={onSkip} disabled={saving}>
              Bỏ qua ảnh này
            </button>
          )}
          <button type="button" className={s.secondaryBtn} onClick={onClose} disabled={saving}>
            Huỷ
          </button>
          <button type="button" className={s.primaryBtn} onClick={() => void save()} disabled={saving}>
            {saving ? 'Đang lưu…' : images.length > 1 ? 'Lưu & ảnh tiếp' : 'Lưu vào kho'}
          </button>
        </div>
      </div>
    </>
  );
}
