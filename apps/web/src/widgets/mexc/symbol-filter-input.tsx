/** True when `symbol` is in the `selected` set, or the set is empty (match all). */
export function matchesSymbolSelection(symbol: string, selected: Set<string>): boolean {
  return selected.size === 0 || selected.has(symbol);
}
