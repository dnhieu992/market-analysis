'use client';

import { useMemo } from 'react';

/** Drops the trailing "USDT" so chips read as the bare coin name (e.g. "BTCUSDT" → "BTC"). */
function stripUsdt(symbol: string): string {
  return symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol;
}

/**
 * Coin-name filter: a row of chips, one per coin, labeled by bare coin name
 * (USDT suffix stripped) and sorted alphabetically Z→A. No chip selected means
 * "all coins" — clicking a chip narrows the table to that coin (on top of any
 * other selected chips); clicking it again removes it from the selection.
 * Shared by the Bitget Positions, History and Setup tabs. Styling:
 * `.bg-schips*` in globals.css.
 */
export function SymbolChipFilter({
  symbols,
  selected,
  onToggle,
  count,
}: {
  /** All coins available to filter (order irrelevant — chips render Z→A by bare name). */
  symbols: string[];
  /** Currently selected coins — empty means "all coins" match. */
  selected: Set<string>;
  onToggle: (symbol: string) => void;
  /** Matched-row count, shown while a selection is active. */
  count?: number;
}) {
  const ordered = useMemo(
    () => [...symbols].sort((a, b) => stripUsdt(b).localeCompare(stripUsdt(a))),
    [symbols],
  );

  return (
    <div className="bg-schips">
      {ordered.map((s) => (
        <button
          key={s}
          type="button"
          className={`bg-schip ${selected.has(s) ? 'bg-schip--on' : ''}`}
          onClick={() => onToggle(s)}
          aria-pressed={selected.has(s)}
        >
          {stripUsdt(s)}
        </button>
      ))}
      {selected.size > 0 && count != null && <span className="bg-sfilter-count">{count} kết quả</span>}
    </div>
  );
}

/** True when `symbol` is in the `selected` set, or the set is empty (match all). */
export function matchesSymbolSelection(symbol: string, selected: Set<string>): boolean {
  return selected.size === 0 || selected.has(symbol);
}
