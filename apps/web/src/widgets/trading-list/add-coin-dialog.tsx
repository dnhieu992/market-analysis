'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import type { TradingListWatchlistSymbol } from '@web/shared/api/types';
import { EXCHANGE_LABEL, EXCHANGE_SHORT } from './exchanges';

/**
 * Turn whatever the trader typed into a USDT-M symbol: uppercase, strip spaces
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
 * "Quản lý coin" dialog for /trading-list: the DB table is the whole coin list,
 * so every coin can be added or removed here. A coin listed on only one
 * exchange carries a "chỉ BG" / "chỉ MX" tag (checked by the API, not editable).
 */
export function AddCoinDialog({
  coins: tracked,
  onAdd,
  onRemove,
  onClose,
}: {
  coins: TradingListWatchlistSymbol[];
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
    if (!window.confirm(`Xoá ${s} khỏi danh sách /trading-list? (Sao, đánh giá và cấu hình vẫn được giữ nếu thêm lại.)`)) return;
    setRemoving(s);
    setError(null);
    try {
      await onRemove(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Xoá coin thất bại.');
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
        aria-label="Quản lý coin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-setup-head">
          <h3>Quản lý coin</h3>
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
                  Sẽ thêm <strong>{symbol}</strong> — hệ thống kiểm tra mã này có hợp đồng futures trên Bitget hoặc
                  MEXC trước khi lưu (nếu chỉ một sàn có, coin được đánh dấu &quot;chỉ BG&quot; / &quot;chỉ MX&quot;).
                </>
              )
            ) : (
              'Không cần gõ đuôi USDT — hệ thống tự thêm.'
            )}
          </p>

          {error && <div className="bg-alert bg-alert--error">{error}</div>}

          <div className="bg-wl-list">
            <span className="bg-wl-list-label">Danh sách coin ({tracked.length})</span>
            {tracked.length === 0 ? (
              <p className="bg-setup-note">Chưa có coin nào.</p>
            ) : (
              <div className="bg-wl-chips">
                {tracked.map((t) => (
                  <span
                    key={t.symbol}
                    className="bg-wl-chip"
                    title={t.onlyExchange ? `Chỉ có trên ${EXCHANGE_LABEL[t.onlyExchange]}` : 'Có trên cả Bitget và MEXC'}
                  >
                    {t.symbol}
                    {t.onlyExchange && <small> · chỉ {EXCHANGE_SHORT[t.onlyExchange]}</small>}
                    <button
                      type="button"
                      className="bg-wl-chip-x"
                      onClick={() => void remove(t.symbol)}
                      disabled={removing === t.symbol}
                      title={`Xoá ${t.symbol} khỏi danh sách`}
                      aria-label={`Xoá ${t.symbol}`}
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
