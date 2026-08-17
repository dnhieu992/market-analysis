'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import type { OkxSetupConfig } from '@web/shared/api/types';

type HoldSide = 'long' | 'short';

export type BulkSideInput = { holdSide: HoldSide; leverage: number; marginUsd: number };

const DEFAULT_LEVERAGE = 10;

function fmtUsdPlain(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Draft state of one side's inputs — kept as strings so the fields can be empty. */
type SideDraft = { on: boolean; leverage: string; marginUsd: string };

/** Parsed draft, or null when the side is off / its numbers are unusable. */
function parseSide(holdSide: HoldSide, draft: SideDraft): BulkSideInput | null {
  if (!draft.on) return null;
  const leverage = Number(draft.leverage);
  const marginUsd = Number(draft.marginUsd);
  const ok =
    Number.isFinite(leverage) &&
    leverage >= 1 &&
    leverage <= 125 &&
    Number.isFinite(marginUsd) &&
    marginUsd > 0;
  return ok ? { holdSide, leverage, marginUsd } : null;
}

type Props = {
  /** Every coin listed on the Setup tab, in display order. */
  symbols: string[];
  /** Coins pre-ticked when the dialog opens (the tab's active filter). */
  initialSymbols: string[];
  /** Existing configs keyed by `${symbol}-${holdSide}` — drives the overwrite warning. */
  configs: Record<string, OkxSetupConfig>;
  saving: boolean;
  onSave: (input: { symbols: string[]; sides: BulkSideInput[] }) => void;
  onClose: () => void;
};

/**
 * Bulk Setup dialog: LONG and SHORT each get their OWN leverage + margin, and the
 * enabled side(s) are written to every selected coin. Saving OVERWRITES the
 * existing config of each selected `coin × enabled side` pair — a side that is
 * switched off is left untouched — so the dialog states up front how many
 * existing configs the save will replace.
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
  const [long, setLong] = useState<SideDraft>({ on: true, leverage: String(DEFAULT_LEVERAGE), marginUsd: '' });
  const [short, setShort] = useState<SideDraft>({ on: true, leverage: String(DEFAULT_LEVERAGE), marginUsd: '' });
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

  const sides = useMemo(
    () => [parseSide('long', long), parseSide('short', short)].filter((s): s is BulkSideInput => s != null),
    [long, short],
  );
  // A side that is switched on but not fully/validly filled in blocks the save,
  // so a typo can never silently drop half the batch.
  const incomplete = (long.on && !parseSide('long', long)) || (short.on && !parseSide('short', short));
  const valid = !incomplete && sides.length > 0 && picked.length > 0;

  const pairCount = picked.length * sides.length;
  // How many of those pairs already have a config → i.e. will be REPLACED.
  const overwriteCount = useMemo(
    () =>
      picked.reduce(
        (sum, s) => sum + sides.filter((side) => configs[`${s}-${side.holdSide}`] != null).length,
        0,
      ),
    [picked, sides, configs],
  );

  const toggleSymbol = (s: string) =>
    setPicked((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const sideBlock = (
    holdSide: HoldSide,
    draft: SideDraft,
    setDraft: (next: SideDraft) => void,
  ) => {
    const isLong = holdSide === 'long';
    return (
      <div className={`bg-bulk-side ${draft.on ? (isLong ? 'bg-bulk-side--long' : 'bg-bulk-side--short') : ''}`}>
        <label className="bg-bulk-side-head">
          <input
            type="checkbox"
            checked={draft.on}
            onChange={(e) => setDraft({ ...draft, on: e.target.checked })}
          />
          <span className={`bg-side ${isLong ? 'bg-side--long' : 'bg-side--short'}`}>
            {isLong ? 'LONG' : 'SHORT'}
          </span>
        </label>
        <label className="bg-setup-field">
          <span>Đòn bẩy (×)</span>
          <input
            type="number"
            min={1}
            max={125}
            step={1}
            disabled={!draft.on}
            value={draft.leverage}
            onChange={(e) => setDraft({ ...draft, leverage: e.target.value })}
          />
        </label>
        <label className="bg-setup-field">
          <span>Ký quỹ (USDT)</span>
          <input
            type="number"
            min={0}
            step="any"
            disabled={!draft.on}
            value={draft.marginUsd}
            placeholder="vd: 20"
            onChange={(e) => setDraft({ ...draft, marginUsd: e.target.value })}
          />
        </label>
      </div>
    );
  };

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
          <div className="bg-bulk-row">
            {sideBlock('long', long, setLong)}
            {sideBlock('short', short, setShort)}
          </div>
          {incomplete && (
            <span className="bg-tpsl-hint bg-tpsl-hint--bad">
              Hướng đang bật phải có đòn bẩy 1–125 và ký quỹ &gt; 0 (hoặc tắt hướng đó đi).
            </span>
          )}

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
                  const has = sides.some((side) => configs[`${s}-${side.holdSide}`] != null);
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
            </strong>
            {sides.length > 0 && (
              <>
                :{' '}
                {sides
                  .map(
                    (s) =>
                      `${s.holdSide.toUpperCase()} ${s.leverage}× · ${fmtUsdPlain(s.marginUsd)}`,
                  )
                  .join(' — ')}{' '}
                · cross
              </>
            )}
            .
            {overwriteCount > 0 && (
              <>
                {' '}
                Trong đó <strong className="bg-bulk-warn">{overwriteCount} cấu hình đã có sẽ bị ghi đè</strong>{' '}
                (các coin có dấu ●). Hướng đang tắt giữ nguyên.
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
            onClick={() => onSave({ symbols: picked, sides })}
          >
            {saving ? 'Đang lưu…' : `Lưu ${pairCount || ''} cấu hình`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
