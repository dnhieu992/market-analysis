import { createServerApiClient } from '@web/shared/auth/api-auth';
import type { DashboardOrder } from '@web/shared/api/types';
import { EXCHANGE_HISTORY_LIMIT, mapExchangeClosedTrades } from '@web/shared/api/exchange-orders';
import { PnlCalendarPage } from '@web/pages/pnl-calendar-page/pnl-calendar-page';

export default async function Page() {
  const client = createServerApiClient();

  const [orders, bitgetTrades, mexcTrades] = await Promise.all([
    client
      .fetchOrders({ status: 'closed', pageSize: 1000 })
      .then((r) => r.data)
      .catch(() => [] as DashboardOrder[]),
    // Bitget/MEXC closed trades are not `Order` rows — fold them into the calendar.
    client
      .fetchBitgetHistory({ limit: EXCHANGE_HISTORY_LIMIT })
      .then((h) => h.trades)
      .catch(() => []),
    client
      .fetchMexcHistory({ limit: EXCHANGE_HISTORY_LIMIT })
      .then((h) => h.trades)
      .catch(() => []),
  ]);

  const allOrders = [...orders, ...mapExchangeClosedTrades(bitgetTrades, mexcTrades)];

  return <PnlCalendarPage orders={allOrders} />;
}
