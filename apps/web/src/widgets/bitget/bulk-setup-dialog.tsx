'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import type { BitgetSetupConfig } from '@web/shared/api/types';

type HoldSide = 'long' | 'short';

const DEFAULT_LEVERAGE = 10;

function fmtUsdPlain(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type Props = {
  /** Every coin listed on the Setup tab, in display order. */
  symbols: string[];
  /** Coins pre-ticked when the dialog opens (the tab's active filter). */
  initialSymbols: string[];
  /** Existing configs keyed by `${symbol}-${holdSide}` — drives the overwrite warning. */
  configs: Record<string, BitgetSetupConfig>;
  saving: boolean;
  onSave: (input: {
    symbols: string[];
    holdSides: HoldSide[];
    leverage: number;
    marginUsd: number;
  }) => void;
  onClose: () => void;
};

/**
 * Bulk Setup dialog: one leverage + margin applied to many coins at once, for the
 * chosen side(s). Saving OVERWRITES the existing config of every selected
 * `coin × side` pair — sides that are not ticked are left untouched — so the
 * dialog states up front how many existing configs the save will replace.
 */
export function BulkSetupDialog({
  symbols,
  initialSymbols,
  configs,
  saving,
  onSave,
  onClose,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [sides, setSides] = useState<HoldSide[]>(['long', 'short']);
  const [leverage, setLeverage] = useState(String(DEFAULT_LEVERAGE));
  const [marginUsd, setMarginUsd] = useState('');
  const [picked, setPicked] = useState<string[]>(initialSymbols);
  const [query, setQuery] = useState('');

  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const visible = useMemo(() => {
    const q = query.trim().toUpperCase();
    return q ? symbols.filter((s) => s.includes(q)) : symbols;
  }, [symbols, query]);

  const lev = Number(leverage);
  const margin = Number(marginUsd);
  const validNumbers =
    Number.isFinite(lev) && lev >= 1 && lev <= 125 && Number.isFinite(margin) && margin > 0;
  const valid = validNumbers && picked.length > 0 && sides.length > 0;

  const pairCount = picked.length * sides.length;
  // How many of those pairs already have a config → i.e. will be REPLACED.
  const overwriteCount = useMemo(
    () =>
      picked.reduce(
        (sum, s) => sum + sides.filter((side) => configs[`${s}-${side}`] != null).length,
        0,
      ),
    [picked, sides, configs],
  );

  const toggleSide = (side: HoldSide) =>
    setSides((prev) => (prev.includes(side) ? prev.filter((s) => s !== side) : [...prev, side]));
  const toggleSymbol = (s: string) =>
    setPicked((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  if (!mounted) return null;

  return createPortal(
    <div className="bg-setup-overlay" onClick={onClose}>
      <div
        className="bg-setup-dialog bg-setup-dialog--wide"
        role="dialog"
        aria-modal="true"
        aria-label="Cấu hình nhiều coin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-setup-head">
          <h3>Cấu hình nhiều coin cùng lúc</h3>
          <button type="button" className="bg-setup-x" onClick={onClose} aria-label="Đóng">
            ×
          </button>
        </div>

        <div className="bg-setup-body">
          <div className="bg-setup-field">
            <span>Hướng áp dụng</span>
            <div className="bg-setup-side-toggle">
              {(['long', 'short'] as HoldSide[]).map((side) => {
                const on = sides.includes(side);
                const cls = on ? (side === 'long' ? 'bg-setup-side--long' : 'bg-setup-side--short') : '';
                return (
                  <button
                    key={side}
                    type="button"
                    className={`bg-setup-side ${cls}`}
                    aria-pressed={on}
                    onClick={() => toggleSide(side)}
                  >
                    {on ? '✓ ' : ''}
                    {side === 'long' ? 'LONG' : 'SHORT'}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bg-bulk-row">
            <label className="bg-setup-field">
              <span>Đòn bẩy (×)</span>
              <input
                type="number"
                min={1}
                max={125}
                step={1}
                value={leverage}
                onChange={(e) => setLeverage(e.target.value)}
              />
            </label>
            <label className="bg-setup-field">
              <span>Ký quỹ (USDT)</span>
              <input
                type="number"
                min={0}
                step="any"
                value={marginUsd}
                placeholder="vd: 20"
                onChange={(e) => setMarginUsd(e.target.value)}
              />
            </label>
          </div>

          <div className="bg-setup-field">
            <span>
              Chọn coin{' '}
              <span className="bg-bulk-count">
                {picked.length}/{symbols.length}
              </span>
            </span>
            <div className="bg-bulk-picker-head">
              <input
                type="search"
                className="bg-bulk-search"
                value={query}
                placeholder="Tìm coin…"
                onChange={(e) => setQuery(e.target.value)}
              />
              <button type="button" className="bg-bulk-link" onClick={() => setPicked(visible.slice())}>
                Chọn tất cả{query.trim() ? ' (kết quả tìm)' : ''}
              </button>
              <button type="button" className="bg-bulk-link" onClick={() => setPicked([])}>
                Bỏ chọn
              </button>
            </div>
            <div className="bg-bulk-grid">
              {visible.length === 0 ? (
                <span className="bg-bulk-empty">Không có coin nào khớp.</span>
              ) : (
                visible.map((s) => {
                  const on = picked.includes(s);
                  const has = sides.some((side) => configs[`${s}-${side}`] != null);
                  return (
                    <label key={s} className={`bg-bulk-item ${on ? 'bg-bulk-item--on' : ''}`}>
                      <input type="checkbox" checked={on} onChange={() => toggleSymbol(s)} />
                      <span>{s}</span>
                      {has && (
                        <span className="bg-bulk-dot" title="Coin này đã có cấu hình — sẽ bị ghi đè">
                          ●
                        </span>
                      )}
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <p className="bg-setup-note">
            Sẽ ghi{' '}
            <strong>
              {pairCount} cấu hình ({picked.length} coin × {sides.length} hướng)
            </strong>{' '}
            với <strong>{validNumbers ? `${lev}× · ${fmtUsdPlain(margin)} · cross` : '—'}</strong>.
            {overwriteCount > 0 && (
              <>
                {' '}
                Trong đó <strong className="bg-bulk-warn">{overwriteCount} cấu hình đã có sẽ bị ghi đè</strong>{' '}
                (các coin có dấu ●). Hướng không được chọn giữ nguyên.
              </>
            )}
          </p>
        </div>

        <div className="bg-setup-foot">
          <button type="button" className="bg-setup-cancel" onClick={onClose} disabled={saving}>
            Huỷ
          </button>
          <button
            type="button"
            className="bg-setup-save"
            disabled={!valid || saving}
            onClick={() => onSave({ symbols: picked, holdSides: sides, leverage: lev, marginUsd: margin })}
          >
            {saving ? 'Đang lưu…' : `Lưu ${pairCount || ''} cấu hình`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
