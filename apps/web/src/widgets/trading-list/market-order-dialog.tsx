'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  title: string;
  /** Confirmation lines (what will be sent). */
  lines: string[];
  saving: boolean;
  error: string | null;
  confirmLabel: string;
  children?: ReactNode;
  onConfirm: () => void;
  onClose: () => void;
};

/** Confirm dialog for a /trading-list MARKET order — replaces window.confirm so the entry reason can be attached. */
export function MarketOrderDialog({ title, lines, saving, error, confirmLabel, children, onConfirm, onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);
  if (!mounted) return null;
  return createPortal(
    <div className="bg-setup-overlay" onClick={() => !saving && onClose()}>
      <div className="bg-setup-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="bg-setup-head">
          <h3>{title}</h3>
          <button type="button" className="bg-setup-x" onClick={onClose} aria-label="Đóng" disabled={saving}>
            ×
          </button>
        </div>
        <div className="bg-setup-body">
          {lines.map((l) => (
            <p key={l} className="bg-setup-note">
              {l}
            </p>
          ))}
          {children}
          {error && <span className="bg-tpsl-hint bg-tpsl-hint--bad">{error}</span>}
        </div>
        <div className="bg-setup-foot">
          <button type="button" className="bg-setup-cancel" onClick={onClose} disabled={saving}>
            Huỷ
          </button>
          <button type="button" className="bg-setup-save" onClick={onConfirm} disabled={saving}>
            {saving ? 'Đang gửi…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
