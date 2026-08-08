'use client';

/**
 * Coin-name filter: a free-text box. Empty query means "all coins". The query is
 * split on commas/whitespace, so "btc, eth" matches either — a superset of the
 * checkbox dropdown this replaced. Shared by the Bitget Positions, History and
 * Setup tabs. Styling: `.bg-sfilter*` in globals.css.
 */
export function SymbolFilterInput({
  query,
  onChange,
  count,
  placeholder = 'Nhập tên coin…',
}: {
  query: string;
  onChange: (next: string) => void;
  /** Matched-row count, shown beside the box while a query is active. */
  count?: number;
  placeholder?: string;
}) {
  return (
    <div className="bg-sfilter">
      <input
        type="text"
        className="bg-sfilter-input"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onChange('')}
        placeholder={placeholder}
        aria-label="Lọc coin"
        spellCheck={false}
        autoComplete="off"
      />
      {query.trim().length > 0 && count != null && (
        <span className="bg-sfilter-count">{count} coin</span>
      )}
    </div>
  );
}

/**
 * True when `symbol` matches the free-text `query`. Case-insensitive substring
 * match against any comma/whitespace-separated term; an empty query matches all.
 */
export function matchesSymbolQuery(symbol: string, query: string): boolean {
  const terms = query
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean);
  if (terms.length === 0) return true;
  const s = symbol.toLowerCase();
  return terms.some((t) => s.includes(t));
}
