'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';

import type { ChartSample } from '@web/shared/api/types';
import { renderMarkdown } from '@web/shared/lib/markdown';

import { fmtDate, fmtPrice, fmtZone } from './chart-lab-utils';
import s from './chart-lab.module.css';

/** Read-only view of a trade's entry reason and tags (screenshots: ChartViewerDialog). */
export function ReasonDialog({ sample, onEdit, onClose }: { sample: ChartSample; onEdit: () => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog dialog--wide" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">Lý do vào lệnh · {sample.symbol ?? '?'}</span>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="Đóng">
            ✕
          </button>
        </div>
        <div className="dialog-body">
          <p className={s.meta}>
            Mở {fmtDate(sample.chartTime)} · Vào {fmtZone(sample)} · TP {fmtPrice(sample.tpPrice)} · SL {fmtPrice(sample.slPrice)}
            {sample.result ? ` · Kết quả ${sample.result}` : ''}
          </p>
          {sample.tags.length > 0 && (
            <div className={s.tagBox} style={{ border: 0, padding: 0, marginBottom: 12 }}>
              {sample.tags.map((t) => (
                <span key={t} className={s.tag}>
                  {t}
                </span>
              ))}
            </div>
          )}
          {sample.note?.trim() ? (
            <div className={s.reason} dangerouslySetInnerHTML={{ __html: renderMarkdown(sample.note) }} />
          ) : (
            <p className={s.muted}>Chưa ghi lý do vào lệnh.</p>
          )}
          <div className="dialog-confirm-actions" style={{ marginTop: 18 }}>
            <button type="button" className="btn btn--secondary" onClick={onClose}>
              Đóng
            </button>
            <button type="button" className="btn btn--primary" onClick={onEdit}>
              Sửa
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
