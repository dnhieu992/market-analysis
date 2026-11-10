'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import type { ChartSample } from '@web/shared/api/types';

import { fmtDate } from './chart-lab-utils';
import s from './chart-lab.module.css';

/** Screenshots of one trade: big image, ← / → (keys or buttons) between them, thumbnails below. */
export function ChartViewerDialog({ sample, onClose }: { sample: ChartSample; onClose: () => void }) {
  const [i, setI] = useState(0);
  const imgs = sample.images;
  const n = imgs.length;
  const cur = imgs[i];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && n > 1) setI((x) => (x + 1) % n);
      else if (e.key === 'ArrowLeft' && n > 1) setI((x) => (x - 1 + n) % n);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, n]);

  return createPortal(
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog dialog--fullscreen" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">
            Chart · {sample.symbol ?? '?'} <span className="tt-muted" style={{ fontWeight: 400 }}>· mở {fmtDate(sample.chartTime)}{n > 1 ? ` · ${i + 1}/${n}` : ''}</span>
          </span>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className={`dialog-body ${s.viewerBody}`}>
          {!cur ? (
            <p className="tt-muted">Lệnh này chưa có ảnh chart. Bấm Edit để thêm ảnh.</p>
          ) : (
            <>
              <div className={s.viewerStage}>
                {n > 1 && (
                  <button type="button" className={`${s.viewerNav} ${s.viewerPrev}`} onClick={() => setI((x) => (x - 1 + n) % n)} aria-label="Ảnh trước">
                    ‹
                  </button>
                )}
                <a href={cur.url} target="_blank" rel="noopener noreferrer" title="Mở ảnh gốc ở tab mới">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={cur.url} alt={`Chart ${sample.symbol ?? ''}`} />
                </a>
                {n > 1 && (
                  <button type="button" className={`${s.viewerNav} ${s.viewerNext}`} onClick={() => setI((x) => (x + 1) % n)} aria-label="Ảnh sau">
                    ›
                  </button>
                )}
              </div>
              {n > 1 && (
                <div className={s.viewerThumbs}>
                  {imgs.map((img, k) => (
                    <button key={img.url} type="button" className={k === i ? s.viewerThumbOn : ''} onClick={() => setI(k)} aria-label={`Ảnh ${k + 1}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.url} alt="" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
