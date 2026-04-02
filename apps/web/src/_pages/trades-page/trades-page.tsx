import { createApiClient } from '@web/shared/api/client';
import type { DashboardOrder } from '@web/shared/api/types';
import { TradesHistory } from '@web/widgets/trades-history/trades-history';

async function loadOrders() {
  const client = createApiClient();

  try {
    return await client.fetchOrders();
  } catch {
    return [] as DashboardOrder[];
  }
}

export default async function TradesPage() {
  const orders = await loadOrders();

  return <TradesHistory orders={orders} />;
}
