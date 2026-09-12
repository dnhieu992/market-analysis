## Description
_A coin-name chip filter above the portfolio holdings table (`/portfolio/<id>`), reusing the same `SymbolChipFilter` component and toolbar styling as the Bitget tabs. Clicking a chip narrows the holdings table to that coin; multiple chips can be selected (OR match); no chip selected means "all coins". A "✕ Xoá lọc" button clears the selection and a "N kết quả" count shows while a filter is active._

## Main Flow
1. The holdings list renders a chip per coin (one for every row, including sold-out positions), labeled by bare coin name and sorted A→Z.
2. Clicking a chip toggles it in `selectedCoins` (a `Set<string>` of coinIds).
3. The table rows are filtered with `matchesSymbolSelection(h.coinId, selectedCoins)` — the shared helper that treats an empty set as "match all".
4. The chip count updates live; "Xoá lọc" resets to all coins.

## Layout
- The chips render on a **single horizontally-scrollable row** (they never wrap), so a
  portfolio with many coins keeps the filter one line tall. This is scoped via the
  `.pf-coin-filter` modifier on the toolbar (`flex-wrap: nowrap; overflow-x: auto` on the
  nested `.bg-schips`); the shared Bitget chip rows still wrap as before. The "Lọc coin:"
  label and "✕ Xoá lọc" button stay fixed while only the chips scroll.

## Edge Cases
- **≤1 holding:** the toolbar is hidden (nothing to filter).
- **Empty selection:** all rows show (same as before the feature).
- **No match:** an empty table body; the count reads "0 kết quả".
- **Many coins:** the chip row scrolls horizontally rather than wrapping to a second line.
- **Bare vs USDT symbols:** portfolio coinIds are already bare (e.g. "LINK"), so `stripUsdt` in the shared component is a no-op — chips and matching stay consistent.
- The stats panel (all-time profit, best/worst) is intentionally NOT filtered — it stays portfolio-wide.

## Related Files (FE / BE / Worker)
- `apps/web/src/widgets/portfolio-holdings-list/portfolio-holdings-list.tsx` — adds `selectedCoins` state, the chip toolbar (with the `pf-coin-filter` modifier), and row filtering
- `apps/web/src/widgets/bitget/symbol-filter-input.tsx` — shared `SymbolChipFilter` + `matchesSymbolSelection` (unchanged; now reused here)
- `apps/web/src/app/globals.css` — `.bg-table-toolbar` / `.bg-schip*` styles (reused) plus the scoped `.pf-coin-filter` rules that make the chip row single-line + horizontally scrollable
