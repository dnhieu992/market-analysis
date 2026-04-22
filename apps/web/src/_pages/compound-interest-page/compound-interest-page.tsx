import { createServerApiClient } from '@web/shared/auth/api-auth';
import type { CompoundPortfolio } from '@web/shared/api/types';
import { CompoundPortfoliosList } from '@web/widgets/compound-portfolios-list/compound-portfolios-list';

async function loadPortfolios(): Promise<CompoundPortfolio[]> {
  const client = createServerApiClient();
  try {
    return await client.fetchCompoundPortfolios();
  } catch {
    return [];
  }
}

export default async function CompoundInterestPage() {
  const portfolios = await loadPortfolios();
  return <CompoundPortfoliosList portfolios={portfolios} />;
}
