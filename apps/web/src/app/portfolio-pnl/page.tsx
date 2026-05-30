import { createServerApiClient } from '@web/shared/auth/api-auth';
import type { PortfolioPnlCalendar } from '@web/shared/api/types';
import { PortfolioPnlPage } from '@web/pages/portfolio-pnl-page/portfolio-pnl-page';

export default async function Page() {
  const client = createServerApiClient();
  let data: PortfolioPnlCalendar = { daily: [], byCoin: [] };
  try {
    data = await client.fetchPortfolioPnlCalendar();
  } catch {
    // render empty calendar
  }
  return <PortfolioPnlPage data={data} />;
}
