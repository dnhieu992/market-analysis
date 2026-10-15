/**
 * Coins every paper strategy runs on. A strategy keeps ONE config row / card; its trades carry
 * their own `symbol`, and "at most one open trade" is enforced per (strategy, symbol).
 */
export type PaperSymbol = { symbol: string; short: string };

export const PAPER_SYMBOLS: PaperSymbol[] = [
  { symbol: 'BTCUSDT', short: 'BTC' },
  { symbol: 'ETHUSDT', short: 'ETH' },
  { symbol: 'SOLUSDT', short: 'SOL' },
];
