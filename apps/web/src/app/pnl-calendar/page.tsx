import { createServerApiClient } from '@web/shared/auth/api-auth';
import type { DashboardOrder } from '@web/shared/api/types';
import { PnlCalendarPage } from '@web/pages/pnl-calendar-page/pnl-calendar-page';

export default async function Page() {
  const client = createServerApiClient();
  let orders: DashboardOrder[] = [];
  try {
    orders = await client.fetchOrders();
  } catch {
    // ignore — render empty calendar
  }
  return <PnlCalendarPage orders={orders} />;
}
