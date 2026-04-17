import { createServerApiClient } from '@web/shared/auth/api-auth';
import type { Portfolio } from '@web/shared/api/types';
import { PortfoliosList } from '@web/widgets/portfolios-list/portfolios-list';

async function loadPortfolios(): Promise<Portfolio[]> {
  const client = createServerApiClient();
  try {
    return await client.fetchPortfolios();
  } catch {
    return [];
  }
}

export default async function PortfolioPage() {
  const portfolios = await loadPortfolios();
  return <PortfoliosList portfolios={portfolios} />;
}
