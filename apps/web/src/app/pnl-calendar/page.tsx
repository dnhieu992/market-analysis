import { createServerApiClient } from '@web/shared/auth/api-auth';
import type { DashboardOrder } from '@web/shared/api/types';
import { PnlCalendarPage } from '@web/pages/pnl-calendar-page/pnl-calendar-page';

export default async function Page() {
  const client = createServerApiClient();
  let orders: DashboardOrder[] = [];
  try {
    const result = await client.fetchOrders();
    orders = result.data;
  } catch {
    // ignore — render empty calendar
  }
  return <PnlCalendarPage orders={orders} />;
}
