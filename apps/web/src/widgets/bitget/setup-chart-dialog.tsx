'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { createApiClient, resolveApiBaseUrl } from '@web/shared/api/client';

import { ChartNoteDialog } from './chart-note-dialog';

/** Timeframes offered by the Setup chart dialog switcher. */
export const CHART_TIMEFRAMES = [
  { label: 'M15', tf: '15m' },
  { label: 'M30', tf: 'M30' },
  { label: 'H1',  tf: '1h'  },
  { label: 'H4',  tf: '4h'  },
  { label: 'D1',  tf: '1d'  },
] as const;

/** Timeframe a "Chart" button opens on by default; switchable inside the dialog. */
export const DEFAULT_CHART_TF = '4h';

/** Friendly timeframe label (M15 / M30 / H1 / H4 / D1) for a raw timeframe key. */
export const tfLabelOf = (tf: string) =>
  tf === '15m' ? 'M15' : tf === '1h' ? 'H1' : tf === '4h' ? 'H4' : tf === '1d' ? 'D1' : tf.toUpperCase();

/**
 * Fullscreen chart dialog for a Bitget coin (SonicR system + S/R channels + RSI,
 * all TradingView defaults). The PNG is rendered server-side; we fetch it through
 * the app's authenticated path and show it as a blob URL. A header switcher flips
 * the timeframe in place. Shared by the Setup tab and the open-positions table.
 * When `allowSave` is set, a "💾 Lưu" button snapshots the current chart to R2 (same
 * action as the History tab) so it shows up in the coin's Reference gallery.
 */
export function SetupChartDialog({
  symbol,
  tf: initialTf = DEFAULT_CHART_TF,
  allowSave = false,
  onClose,
}: {
  symbol: string;
  tf?: string;
  allowSave?: boolean;
  onClose: () => void;
}) {
  const [tf, setTf] = useState(initialTf);
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [notePrompt, setNotePrompt] = useState(false);
  const clientRef = useRef(createApiClient());

  const tfLabel = tfLabelOf(tf);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setImgSrc(null);
    setFailed(false);
    setSavedUrl(null);
    setSaveErr(null);
    const url = `${resolveApiBaseUrl()}/bitget/setup-chart?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(tf)}&_t=${Date.now()}`;
    fetch(url, { credentials: 'include', cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setImgSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [symbol, tf]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function save(note: string) {
    setSaving(true);
    setSaveErr(null);
    try {
      const rec = await clientRef.current.saveBitgetSetupChart({ symbol, timeframe: tf, note });
      setSavedUrl(rec.url);
      setNotePrompt(false);
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : 'Lưu chart thất bại.');
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog dialog--fullscreen eb-chart-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">
            {symbol} <span className="eb-tf">{tfLabel}</span>
            <span className="eb-chart-note"> · SonicR + S/R Channel + RSI</span>
          </span>
          <div className="eb-tf-tabs" role="tablist" aria-label="Khung thời gian">
            {CHART_TIMEFRAMES.map(({ label, tf: t }) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={t === tf}
                className={`eb-tf-tab ${t === tf ? 'eb-tf-tab--active' : ''}`}
                onClick={() => setTf(t)}
                title={`Xem khung ${label}`}
              >
                {label}
              </button>
            ))}
          </div>
          {allowSave && (
            <button
              type="button"
              className="bg-open-btn bg-chart-save-btn"
              onClick={() => {
                setSaveErr(null);
                setNotePrompt(true);
              }}
              disabled={saving || !imgSrc}
              title="Thêm ghi chú rồi lưu chart lên R2 để tham chiếu sau"
            >
              {saving ? 'Đang lưu…' : savedUrl ? '✓ Đã lưu' : '💾 Lưu'}
            </button>
          )}
          <button className="dialog-close" onClick={onClose} aria-label="Đóng">
            ✕
          </button>
        </div>
        {saveErr && <div className="bg-alert bg-alert--error">{saveErr}</div>}
        {savedUrl && (
          <div className="bg-alert bg-alert--ok">
            Đã lưu chart ·{' '}
            <a href={savedUrl} target="_blank" rel="noreferrer">
              mở link R2
            </a>
          </div>
        )}
        <div className="dialog-body eb-chart-body">
          {failed ? (
            <div className="eb-chart-status">Không tải được chart. Thử lại sau.</div>
          ) : imgSrc ? (
            <img className="eb-chart-img" src={imgSrc} alt={`${symbol} ${tfLabel} chart`} />
          ) : (
            <div className="eb-chart-status">Đang tải chart…</div>
          )}
        </div>
      </div>
      {notePrompt && (
        <ChartNoteDialog
          saving={saving}
          error={saveErr}
          onSubmit={(note) => void save(note)}
          onCancel={() => setNotePrompt(false)}
        />
      )}
    </div>,
    document.body,
  );
}
