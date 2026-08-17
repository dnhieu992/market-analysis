import type {
  BitgetClosedTrade,
  DashboardOrder,
  MexcClosedTrade,
  OkxClosedTrade,
} from '@web/shared/api/types';

/**
 * Bitget, MEXC and OKX closed trades live outside the `Order` table, so the
 * dashboard cards and the PnL calendar have to fold them in by hand. All three
 * expose the same wire shape, so one mapper covers them — `exchange` keeps them
 * apart.
 */
type ExchangeClosedTrade = BitgetClosedTrade | MexcClosedTrade | OkxClosedTrade;

type ExchangeName = 'bitget' | 'mexc' | 'okx';

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
 * `okxTrades` defaults to empty so the two-exchange call sites keep compiling,
 * but every view that totals realized PnL must pass it — the overview card sums
 * all three, and a caller that skips OKX reports a smaller number for the same
 * book.
 */
export function mapExchangeClosedTrades(
  bitgetTrades: readonly BitgetClosedTrade[],
  mexcTrades: readonly MexcClosedTrade[],
  okxTrades: readonly OkxClosedTrade[] = [],
): DashboardOrder[] {
  return [
    ...bitgetTrades.map((t) => mapClosedTrade(t, 'bitget')),
    ...mexcTrades.map((t) => mapClosedTrade(t, 'mexc')),
    ...okxTrades.map((t) => mapClosedTrade(t, 'okx')),
  ];
}

/** Max rows the `/bitget/history`, `/mexc/history` and `/okx/history` endpoints will return. */
export const EXCHANGE_HISTORY_LIMIT = 500;
