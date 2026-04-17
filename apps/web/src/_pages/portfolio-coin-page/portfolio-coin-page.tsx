import { createServerApiClient } from '@web/shared/auth/api-auth';
import type { CoinTransaction, Holding } from '@web/shared/api/types';
import { PortfolioCoinDetail } from '@web/widgets/portfolio-coin-detail/portfolio-coin-detail';

type PortfolioCoinPageProps = Readonly<{
  portfolioId: string;
  coinId: string;
}>;

async function loadCoinData(portfolioId: string, coinId: string): Promise<{
  holding: Holding | null;
  transactions: CoinTransaction[];
}> {
  const client = createServerApiClient();
  const [allHoldings, transactions] = await Promise.allSettled([
    client.fetchHoldings(portfolioId),
    client.fetchTransactions(portfolioId, { coinId })
  ]);

  const holdings = allHoldings.status === 'fulfilled' ? allHoldings.value : [];
  const holding = holdings.find((h) => h.coinId === coinId) ?? null;

  return {
    holding,
    transactions: transactions.status === 'fulfilled' ? transactions.value : []
  };
}

export default async function PortfolioCoinPage({ portfolioId, coinId }: PortfolioCoinPageProps) {
  const { holding, transactions } = await loadCoinData(portfolioId, coinId);

  return (
    <PortfolioCoinDetail
      portfolioId={portfolioId}
      coinId={coinId}
      holding={holding}
      transactions={transactions}
    />
  );
}
