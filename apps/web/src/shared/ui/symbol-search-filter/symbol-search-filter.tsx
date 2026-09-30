'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

/** Drops the trailing "USDT" so coins read as the bare name (e.g. "BTCUSDT" → "BTC"). */
function stripUsdt(symbol: string): string {
  return symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol;
}

/**
 * Coin-name filter as a text input with auto-suggestion. Typing narrows a
 * dropdown of coins (bare name, prefix matches first, then substring matches);
 * picking one adds it as a removable tag. No tag means "all coins" match.
 * Keyboard: ↑/↓ move, Enter picks, Escape closes, Backspace on an empty input
 * removes the last tag. Drop-in replacement for `SymbolChipFilter` (same props)
 * on the Bitget and MEXC Positions / History / Setup tabs. Styling: `.ssf-*`
 * in globals.css.
 */
export function SymbolSearchFilter({
  symbols,
  selected,
  onToggle,
  count,
}: {
  /** All coins available to filter. */
  symbols: string[];
  /** Currently selected coins — empty means "all coins" match. */
  selected: Set<string>;
  onToggle: (symbol: string) => void;
  /** Matched-row count, shown while a selection is active. */
  count?: number;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selectedOrdered = useMemo(
    () => [...selected].sort((a, b) => stripUsdt(a).localeCompare(stripUsdt(b))),
    [selected],
  );

  const suggestions = useMemo(() => {
    const q = query.trim().toUpperCase();
    const pool = symbols
      .filter((s) => !selected.has(s))
      .sort((a, b) => stripUsdt(a).localeCompare(stripUsdt(b)));
    if (!q) return pool;
    const prefix = pool.filter((s) => stripUsdt(s).startsWith(q));
    const contains = pool.filter((s) => !stripUsdt(s).startsWith(q) && s.includes(q));
    return [...prefix, ...contains];
  }, [symbols, selected, query]);

  // Keep the highlighted row valid as the list shrinks / grows.
  useEffect(() => {
    setActive((i) => Math.min(i, Math.max(suggestions.length - 1, 0)));
  }, [suggestions.length]);

  // Close on outside click/tap.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // Keep the highlighted row scrolled into view during keyboard navigation.
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (symbol: string) => {
    onToggle(symbol);
    setQuery('');
    setActive(0);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      const hit = suggestions[active];
      if (open && hit) {
        e.preventDefault();
        pick(hit);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Backspace' && query === '') {
      const last = selectedOrdered.at(-1);
      if (last) onToggle(last);
    }
  };

  return (
    <div className="ssf" ref={rootRef}>
      <div className="ssf-box" onClick={() => inputRef.current?.focus()}>
        {selectedOrdered.map((s) => (
          <span key={s} className="ssf-tag">
            {stripUsdt(s)}
            <button
              type="button"
              className="ssf-tag-x"
              onClick={(e) => {
                e.stopPropagation();
                onToggle(s);
              }}
              aria-label={`Bỏ lọc ${stripUsdt(s)}`}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="ssf-input"
          type="text"
          value={query}
          placeholder={selected.size === 0 ? 'Gõ tên coin…' : ''}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
      </div>
      {selected.size > 0 && count != null && <span className="bg-sfilter-count">{count} kết quả</span>}
      {open && (
        <ul className="ssf-list" role="listbox" ref={listRef}>
          {suggestions.length === 0 ? (
            <li className="ssf-empty">Không có coin khớp</li>
          ) : (
            suggestions.map((s, i) => (
              <li
                key={s}
                role="option"
                aria-selected={i === active}
                className={`ssf-option ${i === active ? 'ssf-option--active' : ''}`}
                // mousedown (not click) + preventDefault keeps focus in the input.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s);
                }}
                onMouseEnter={() => setActive(i)}
              >
                {stripUsdt(s)}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
