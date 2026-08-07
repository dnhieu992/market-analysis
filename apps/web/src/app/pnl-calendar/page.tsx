import { createServerApiClient } from '@web/shared/auth/api-auth';
import type { DashboardOrder, PortfolioPnlCalendar } from '@web/shared/api/types';
import { EXCHANGE_HISTORY_LIMIT, mapExchangeClosedTrades } from '@web/shared/api/exchange-orders';
import { PnlHubPage } from '@web/pages/pnl-hub-page/pnl-hub-page';
// `parseTab` must come from the non-client module — see the note in shared.ts.
import { parseTab } from '@web/pages/pnl-hub-page/shared';

type Props = {
  searchParams: Record<string, string | string[] | undefined>;
};

export default async function Page({ searchParams }: Props) {
  const client = createServerApiClient();

  const [orders, bitgetTrades, mexcTrades, portfolio] = await Promise.all([
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
    client
      .fetchPortfolioPnlCalendar()
      .catch(() => ({ daily: [], byCoin: [] }) as PortfolioPnlCalendar),
  ]);

  const allOrders = [...orders, ...mapExchangeClosedTrades(bitgetTrades, mexcTrades)];

  return (
    <PnlHubPage
      orders={allOrders}
      portfolio={portfolio}
      initialTab={parseTab(searchParams?.tab)}
    />
  );
}
