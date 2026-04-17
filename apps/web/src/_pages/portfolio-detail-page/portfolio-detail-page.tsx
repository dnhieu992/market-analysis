import { createServerApiClient } from '@web/shared/auth/api-auth';
import type { CoinTransaction, Holding, PnlSnapshot, Portfolio } from '@web/shared/api/types';
import { PortfolioHoldings } from '@web/widgets/portfolio-holdings/portfolio-holdings';
import { PortfolioPnl } from '@web/widgets/portfolio-pnl/portfolio-pnl';
import { PortfolioTransactions } from '@web/widgets/portfolio-transactions/portfolio-transactions';

type PortfolioDetailPageProps = Readonly<{
  portfolioId: string;
}>;

async function loadPortfolioData(portfolioId: string): Promise<{
  portfolio: Portfolio | null;
  holdings: Holding[];
  transactions: CoinTransaction[];
  pnlHistory: PnlSnapshot[];
}> {
  const client = createServerApiClient();

  const [portfolio, holdings, transactions, pnlHistory] = await Promise.allSettled([
    client.fetchPortfolio(portfolioId),
    client.fetchHoldings(portfolioId),
    client.fetchTransactions(portfolioId),
    client.fetchPnlHistory(portfolioId)
  ]);

  return {
    portfolio: portfolio.status === 'fulfilled' ? portfolio.value : null,
    holdings: holdings.status === 'fulfilled' ? holdings.value : [],
    transactions: transactions.status === 'fulfilled' ? transactions.value : [],
    pnlHistory: pnlHistory.status === 'fulfilled' ? pnlHistory.value : []
  };
}

export default async function PortfolioDetailPage({ portfolioId }: PortfolioDetailPageProps) {
  const { portfolio, holdings, transactions, pnlHistory } = await loadPortfolioData(portfolioId);

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
      <div style={{ padding: '1rem 0 0.5rem' }}>
        <h1 style={{ margin: 0 }}>{portfolio.name}</h1>
        {portfolio.description && <p className="tt-muted">{portfolio.description}</p>}
      </div>

      <PortfolioHoldings portfolioId={portfolioId} holdings={holdings} />
      <PortfolioTransactions portfolioId={portfolioId} transactions={transactions} />
      <PortfolioPnl snapshots={pnlHistory} />
    </main>
  );
}
