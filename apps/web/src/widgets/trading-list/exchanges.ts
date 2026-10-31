import type { TradingExchange } from '@web/shared/api/types';

/** Display order everywhere on /trading-list. */
export const EXCHANGES: readonly TradingExchange[] = ['bitget', 'mexc'];

export const EXCHANGE_LABEL: Record<TradingExchange, string> = { bitget: 'Bitget', mexc: 'MEXC' };

/** The tag shown on every line / card so an order never lands on the wrong exchange. */
export const EXCHANGE_SHORT: Record<TradingExchange, string> = { bitget: 'BG', mexc: 'MX' };
