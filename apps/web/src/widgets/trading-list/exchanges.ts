import type { TradingExchange } from '@web/shared/api/types';

/** Display order everywhere on /trading-list. */
export const EXCHANGES: readonly TradingExchange[] = ['bitget', 'mexc'];

export const EXCHANGE_LABEL: Record<TradingExchange, string> = { bitget: 'Bitget', mexc: 'MEXC' };

/** The tag shown on every line / card so an order never lands on the wrong exchange. */
export const EXCHANGE_SHORT: Record<TradingExchange, string> = { bitget: 'BG', mexc: 'MX' };

/** Per-tab exchange filter on /trading-list: both exchanges or just one. */
export type ExchangeFilter = 'all' | TradingExchange;

/** The exchanges a filter keeps, in display order. */
export function exchangesOf(filter: ExchangeFilter): readonly TradingExchange[] {
  return filter === 'all' ? EXCHANGES : EXCHANGES.filter((ex) => ex === filter);
}
