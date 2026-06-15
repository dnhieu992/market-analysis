/**
 * Optimal UTBot keyValue per (symbol, timeframe) for the stop-and-reverse flip strategy.
 *
 * Source: the flip backtests in `claude-backtest/runs/` (compounded $1000, fee 0.05%/side,
 * 365 days). These are the keyValue that maximised risk-adjusted return for each config.
 * They reflect a SINGLE year / SINGLE regime — re-run the backtests periodically and update
 * this table; do not treat the numbers as permanent.
 *
 * Resolution (see `resolveKeyValue`):
 *   - settings.keyValue > 0  → explicit manual override, used as-is.
 *   - settings.keyValue <= 0 → "auto": look up this table by `SYMBOL:timeframe`.
 *   - no table entry         → fall back to DEFAULT_KEY_VALUE.
 */
export const DEFAULT_KEY_VALUE = 2;

/** Keyed by `${SYMBOL_UPPER}:${timeframe_lower}`. */
export const OPTIMAL_KEY_VALUE: Readonly<Record<string, number>> = {
  'ETHUSDT:4h': 2,
  'ETHUSDT:1d': 1,
  'BNBUSDT:4h': 4,
  'BNBUSDT:1d': 4,
  'BTCUSDT:1d': 2,
  'SOLUSDT:1d': 2,
};

export type KeyValueSource = 'settings' | 'table' | 'default';

export type ResolvedKeyValue = {
  keyValue: number;
  source: KeyValueSource;
};

function tableKey(symbol: string, timeframe: string): string {
  return `${symbol.trim().toUpperCase()}:${timeframe.trim().toLowerCase()}`;
}

/**
 * Resolve the keyValue to actually trade with.
 * A positive `settingsKeyValue` is an explicit override; 0 or negative means "auto".
 */
export function resolveKeyValue(
  symbol: string,
  timeframe: string,
  settingsKeyValue: number,
): ResolvedKeyValue {
  if (settingsKeyValue > 0) {
    return { keyValue: settingsKeyValue, source: 'settings' };
  }
  const fromTable = OPTIMAL_KEY_VALUE[tableKey(symbol, timeframe)];
  if (fromTable !== undefined) {
    return { keyValue: fromTable, source: 'table' };
  }
  return { keyValue: DEFAULT_KEY_VALUE, source: 'default' };
}
