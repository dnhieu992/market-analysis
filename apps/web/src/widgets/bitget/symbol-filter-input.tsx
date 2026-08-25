'use client';

/**
 * Coin-name filter: a row of chips, one per coin. No chip selected means "all
 * coins" — clicking a chip narrows the table to that coin (on top of any other
 * selected chips); clicking it again removes it from the selection. Shared by
 * the Bitget Positions, History and Setup tabs. Styling: `.bg-schips*` in
 * globals.css.
 */
export function SymbolChipFilter({
  symbols,
  selected,
  onToggle,
  count,
}: {
  /** All coins available to filter, in display order. */
  symbols: string[];
  /** Currently selected coins — empty means "all coins" match. */
  selected: Set<string>;
  onToggle: (symbol: string) => void;
  /** Matched-row count, shown while a selection is active. */
  count?: number;
}) {
  return (
    <div className="bg-schips">
      {symbols.map((s) => (
        <button
          key={s}
          type="button"
          className={`bg-schip ${selected.has(s) ? 'bg-schip--on' : ''}`}
          onClick={() => onToggle(s)}
          aria-pressed={selected.has(s)}
        >
          {s}
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
