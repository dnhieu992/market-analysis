'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import type { ChartSample } from '@web/shared/api/types';
import { renderMarkdown } from '@web/shared/lib/markdown';

import { fmtDate, fmtPrice, fmtZone } from './chart-lab-utils';
import s from './chart-lab.module.css';

/** Read-only view of a trade's entry reason, with its tags and screenshots. */
export function ReasonDialog({ sample, onEdit, onClose }: { sample: ChartSample; onEdit: () => void; onClose: () => void }) {
  const [zoom, setZoom] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (zoom) setZoom(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, zoom]);

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
          {sample.images.length > 0 && (
            <div className={s.images}>
              {sample.images.map((img) => (
                <button key={img.url} type="button" onClick={() => setZoom(img.url)} aria-label="Xem ảnh">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt="chart" loading="lazy" />
                </button>
              ))}
            </div>
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
      {zoom && (
        <div className="lightbox-backdrop" onClick={(e) => (e.stopPropagation(), setZoom(null))}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="chart" className="lightbox-img" />
        </div>
      )}
    </div>,
    document.body,
  );
}
