import { createServerApiClient } from '@web/shared/auth/api-auth';
import type { Holding, Portfolio } from '@web/shared/api/types';
import { PortfoliosList } from '@web/widgets/portfolios-list/portfolios-list';

async function loadPortfolios(): Promise<{ portfolios: Portfolio[]; holdingsMap: Record<string, Holding[]> }> {
  const client = createServerApiClient();
  try {
    const portfolios = await client.fetchPortfolios();
    const holdingsResults = await Promise.allSettled(portfolios.map((p) => client.fetchHoldings(p.id)));
    const holdingsMap: Record<string, Holding[]> = {};
    portfolios.forEach((p, i) => {
      const result = holdingsResults[i];
      holdingsMap[p.id] = result.status === 'fulfilled' ? result.value : [];
    });
    return { portfolios, holdingsMap };
  } catch {
    return { portfolios: [], holdingsMap: {} };
  }
}

export default async function PortfolioPage() {
  const { portfolios, holdingsMap } = await loadPortfolios();
  return <PortfoliosList portfolios={portfolios} holdingsMap={holdingsMap} />;
}
