import Link from 'next/link';

import { createServerApiClient } from '@web/shared/auth/api-auth';
import type { Holding, Portfolio } from '@web/shared/api/types';
import { PortfolioHoldingsList } from '@web/widgets/portfolio-holdings-list/portfolio-holdings-list';

type PortfolioDetailPageProps = Readonly<{
  portfolioId: string;
}>;

async function loadPortfolioData(portfolioId: string): Promise<{
  portfolio: Portfolio | null;
  holdings: Holding[];
}> {
  const client = createServerApiClient();
  const [portfolio, holdings] = await Promise.allSettled([
    client.fetchPortfolio(portfolioId),
    client.fetchHoldings(portfolioId)
  ]);

  return {
    portfolio: portfolio.status === 'fulfilled' ? portfolio.value : null,
    holdings: holdings.status === 'fulfilled' ? holdings.value : []
  };
}

export default async function PortfolioDetailPage({ portfolioId }: PortfolioDetailPageProps) {
  const { portfolio, holdings } = await loadPortfolioData(portfolioId);

  if (!portfolio) {
    return (
      <main className="dashboard-shell">
        <article className="panel">
          <p className="tt-muted" style={{ padding: '1rem' }}>Portfolio not found.</p>
        </article>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <div style={{ padding: '0.75rem 0 0' }}>
        <Link
          href="/portfolio"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: 'var(--muted)', textDecoration: 'none', fontSize: '0.95rem' }}
        >
          ‹ Back
        </Link>
      </div>

      <div style={{ padding: '0.5rem 0 0.75rem' }}>
        <h1 style={{ margin: 0 }}>{portfolio.name}</h1>
        {portfolio.description && <p className="tt-muted" style={{ margin: '0.25rem 0 0' }}>{portfolio.description}</p>}
      </div>

      <PortfolioHoldingsList portfolioId={portfolioId} holdings={holdings} />
    </main>
  );
}
