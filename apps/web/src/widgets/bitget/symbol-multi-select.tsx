'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Coin-name filter: a button that opens a checkbox dropdown of every coin passed
 * in. Empty selection means "all coins". Closes on outside click / Escape. Shared
 * by the Bitget History and Setup tabs. Styling: `.bg-msel*` in globals.css.
 */
export function SymbolMultiSelect({
  symbols,
  selected,
  onChange,
}: {
  symbols: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = (s: string) =>
    onChange(selected.includes(s) ? selected.filter((x) => x !== s) : [...selected, s]);

  const label =
    selected.length === 0
      ? 'Tất cả coin'
      : selected.length === 1
        ? selected[0]!
        : `${selected.length} coin đã chọn`;

  return (
    <div className="bg-msel" ref={ref}>
      <button
        type="button"
        className="bg-msel-btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="bg-msel-label">{label}</span>
        <span className="bg-msel-caret">▾</span>
      </button>
      {open && (
        <div className="bg-msel-menu" role="listbox" aria-multiselectable="true">
          <div className="bg-msel-actions">
            <button type="button" onClick={() => onChange(symbols.slice())}>
              Chọn tất cả
            </button>
            <button type="button" onClick={() => onChange([])}>
              Bỏ chọn
            </button>
          </div>
          <div className="bg-msel-list">
            {symbols.map((s) => (
              <label key={s} className="bg-msel-item">
                <input
                  type="checkbox"
                  checked={selected.includes(s)}
                  onChange={() => toggle(s)}
                />
                <span>{s}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
