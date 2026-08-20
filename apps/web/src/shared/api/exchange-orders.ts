import type {
  BitgetClosedTrade,
  DashboardOrder,
  MexcClosedTrade,
} from '@web/shared/api/types';

/**
 * Bitget and MEXC closed trades live outside the `Order` table, so the
 * dashboard cards and the PnL calendar have to fold them in by hand. Both
 * expose the same wire shape, so one mapper covers them — `exchange` keeps them
 * apart.
 */
type ExchangeClosedTrade = BitgetClosedTrade | MexcClosedTrade;

type ExchangeName = 'bitget' | 'mexc';

function mapClosedTrade(trade: ExchangeClosedTrade, exchange: ExchangeName): DashboardOrder {
  const openedAt = new Date(trade.openedAt);
  const closedAt = new Date(trade.closedAt);
  return {
    id: `${exchange}:${trade.positionId}`,
    symbol: trade.symbol,
    side: trade.holdSide,
    status: 'closed',
    entryPrice: trade.openAvgPrice,
    openedAt,
    closedAt,
    createdAt: openedAt,
    updatedAt: closedAt,
    closePrice: trade.closeAvgPrice,
    pnl: trade.netProfit,
    quantity: trade.size,
    source: exchange,
    exchange,
  };
}

/**
 * Every view that totals realized PnL must pass both exchanges — the overview
 * card sums the same two, and a caller that skips one reports a smaller number
 * for the same book.
 */
export function mapExchangeClosedTrades(
  bitgetTrades: readonly BitgetClosedTrade[],
  mexcTrades: readonly MexcClosedTrade[],
): DashboardOrder[] {
  return [
    ...bitgetTrades.map((t) => mapClosedTrade(t, 'bitget')),
    ...mexcTrades.map((t) => mapClosedTrade(t, 'mexc')),
  ];
}

/** Max rows the `/bitget/history` and `/mexc/history` endpoints will return. */
export const EXCHANGE_HISTORY_LIMIT = 500;
