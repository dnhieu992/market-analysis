import { createServerApiClient } from '@web/shared/auth/api-auth';
import type { DashboardOrder } from '@web/shared/api/types';
import { TradesHistory } from '@web/widgets/trades-history/trades-history';

async function loadOrders() {
  const client = createServerApiClient();

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
