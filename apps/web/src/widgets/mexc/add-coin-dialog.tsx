'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import type { MexcWatchlistSymbol } from '@web/shared/api/types';

/**
 * Turn whatever the trader typed into a MEXC symbol: uppercase, strip spaces
 * and the `_` / `/` separators people paste from the exchange, and default the
 * quote asset to USDT (`SUI` → `SUIUSDT`) since every contract here is USDT-M.
 */
export function normalizeSymbol(raw: string): string {
  const s = raw
    .trim()
    .toUpperCase()
    .replace(/[\s_/-]/g, '');
  if (!s) return '';
  return s.endsWith('USDT') ? s : `${s}USDT`;
}

/**
 * "Thêm coin" dialog for the Setup tab: type a symbol to start tracking it, and
 * remove any coin added this way. Coins that come from the built-in list or
 * from trade history are not listed here — they are not removable.
 */
export function AddCoinDialog({
  tracked,
  onAdd,
  onRemove,
  onClose,
}: {
  tracked: MexcWatchlistSymbol[];
  onAdd: (symbol: string) => Promise<void>;
  onRemove: (symbol: string) => Promise<void>;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const symbol = useMemo(() => normalizeSymbol(raw), [raw]);
  const already = tracked.some((t) => t.symbol === symbol);
  const valid = /^[A-Z0-9]{4,30}$/.test(symbol) && !already;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onAdd(symbol);
      setRaw('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Thêm coin thất bại.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (s: string) => {
    if (removing) return;
    setRemoving(s);
    setError(null);
    try {
      await onRemove(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bỏ theo dõi thất bại.');
    } finally {
      setRemoving(null);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div className="bg-setup-overlay" onClick={onClose}>
      <div
        className="bg-setup-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Thêm coin theo dõi"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-setup-head">
          <h3>Thêm coin theo dõi</h3>
          <button type="button" className="bg-setup-x" onClick={onClose} aria-label="Đóng">
            ×
          </button>
        </div>

        <div className="bg-setup-body">
          <label className="bg-setup-field">
            <span>Mã coin</span>
            <input
              type="text"
              value={raw}
              placeholder="vd: SUI hoặc SUIUSDT"
              autoFocus
              onChange={(e) => {
                setRaw(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
            />
          </label>

          <p className="bg-setup-note">
            {symbol ? (
              already ? (
                <>
                  <strong>{symbol}</strong> đã có trong danh sách.
                </>
              ) : (
                <>
                  Sẽ thêm <strong>{symbol}</strong> — hệ thống kiểm tra mã này có hợp đồng futures trên
                  MEXC trước khi lưu.
                </>
              )
            ) : (
              'Không cần gõ đuôi USDT — hệ thống tự thêm.'
            )}
          </p>

          {error && <div className="bg-alert bg-alert--error">{error}</div>}

          <div className="bg-wl-list">
            <span className="bg-wl-list-label">Coin đã thêm thủ công ({tracked.length})</span>
            {tracked.length === 0 ? (
              <p className="bg-setup-note">
                Chưa có coin nào. Danh sách mặc định và các coin đã từng giao dịch vẫn hiện trong bảng.
              </p>
            ) : (
              <div className="bg-wl-chips">
                {tracked.map((t) => (
                  <span key={t.symbol} className="bg-wl-chip">
                    {t.symbol}
                    <button
                      type="button"
                      className="bg-wl-chip-x"
                      onClick={() => void remove(t.symbol)}
                      disabled={removing === t.symbol}
                      title={`Bỏ theo dõi ${t.symbol}`}
                      aria-label={`Bỏ theo dõi ${t.symbol}`}
                    >
                      {removing === t.symbol ? '…' : '×'}
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="bg-setup-foot">
          <button type="button" className="bg-setup-cancel" onClick={onClose}>
            Đóng
          </button>
          <button type="button" className="bg-setup-save" disabled={!valid || busy} onClick={() => void submit()}>
            {busy ? 'Đang thêm…' : 'Thêm'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
