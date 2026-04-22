import Link from 'next/link';

import { createServerApiClient } from '@web/shared/auth/api-auth';
import type { CompoundHolding, CompoundPortfolio } from '@web/shared/api/types';
import { CompoundHoldingsList } from '@web/widgets/compound-holdings-list/compound-holdings-list';

type CompoundInterestDetailPageProps = Readonly<{
  portfolioId: string;
}>;

async function loadData(portfolioId: string): Promise<{
  portfolio: CompoundPortfolio | null;
  holdings: CompoundHolding[];
}> {
  const client = createServerApiClient();
  const [portfolio, holdings] = await Promise.allSettled([
    client.fetchCompoundPortfolio(portfolioId),
    client.fetchCompoundHoldings(portfolioId)
  ]);

  return {
    portfolio: portfolio.status === 'fulfilled' ? portfolio.value : null,
    holdings: holdings.status === 'fulfilled' ? holdings.value : []
  };
}

export default async function CompoundInterestDetailPage({ portfolioId }: CompoundInterestDetailPageProps) {
  const { portfolio, holdings } = await loadData(portfolioId);

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
          href="/compound-interest"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: 'var(--muted)', textDecoration: 'none', fontSize: '0.95rem' }}
        >
          ‹ Back
        </Link>
      </div>

      <div style={{ padding: '0.5rem 0 0.75rem' }}>
        <h1 style={{ margin: 0 }}>{portfolio.name}</h1>
        {portfolio.description && <p className="tt-muted" style={{ margin: '0.25rem 0 0' }}>{portfolio.description}</p>}
      </div>

      <CompoundHoldingsList portfolioId={portfolioId} holdings={holdings} />
    </main>
  );
}
