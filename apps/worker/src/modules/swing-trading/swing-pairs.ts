/**
 * Hardcoded list of swing-trading pairs the scanner trades, one independent
 * UTBot stop-and-reverse position book per pair.
 *
 * Source: the 365-day flip backtests in `claude-backtest/runs/` (2026-06-15,
 * compounded $1000, fee 0.05%/side). Only the configs that proved **robust**
 * (winning parameter stable across neighbouring keyValues, real magnitude, low
 * drawdown) are listed — curve-fit rejects (XRP, SUI, LINK, DOGE, SHIB, ADA)
 * are intentionally excluded.
 *
 * `keyValue` here is the per-pair optimum and is used as-is (it bypasses the
 * singleton `settings.keyValue`, whose single value cannot be right for every
 * coin — e.g. BNB needs kv=4 while ETH needs kv=2). It mirrors the optimums in
 * `utbot-kv-table.ts`; keep the two in sync when re-running backtests.
 *
 * NOTE: the web settings panel renders this same list (hardcoded in
 * `swing-trading-feed.tsx`); update both together if the pairs change.
 */
export type SwingPair = {
  symbol: string;
  timeframe: string;
  keyValue: number;
};

export const SWING_PAIRS: readonly SwingPair[] = [
  { symbol: 'ETHUSDT', timeframe: '4h', keyValue: 2 }, // +88%/yr — core
  { symbol: 'BTCUSDT', timeframe: '1d', keyValue: 2 }, // +37%/yr, DD 11.9% — best risk-adjusted
  { symbol: 'BNBUSDT', timeframe: '4h', keyValue: 4 }, // +71%/yr, pullback add-on amplifies (kv=4)
  { symbol: 'SOLUSDT', timeframe: '1d', keyValue: 2 }, // +22.9%/yr — diversification
];
