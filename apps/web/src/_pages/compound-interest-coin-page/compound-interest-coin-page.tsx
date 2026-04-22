import { createServerApiClient } from '@web/shared/auth/api-auth';
import type { CompoundHolding, CompoundTransaction } from '@web/shared/api/types';
import { CompoundCoinDetail } from '@web/widgets/compound-coin-detail/compound-coin-detail';

type CompoundInterestCoinPageProps = Readonly<{
  portfolioId: string;
  coinId: string;
}>;

async function loadCoinData(portfolioId: string, coinId: string): Promise<{
  holding: CompoundHolding | null;
  transactions: CompoundTransaction[];
}> {
  const client = createServerApiClient();
  const [allHoldings, transactions] = await Promise.allSettled([
    client.fetchCompoundHoldings(portfolioId),
    client.fetchCompoundTransactions(portfolioId, { coinId })
  ]);

  const holdings = allHoldings.status === 'fulfilled' ? allHoldings.value : [];
  const holding = holdings.find((h) => h.coinId === coinId) ?? null;

  return {
    holding,
    transactions: transactions.status === 'fulfilled' ? transactions.value : []
  };
}

export default async function CompoundInterestCoinPage({ portfolioId, coinId }: CompoundInterestCoinPageProps) {
  const { holding, transactions } = await loadCoinData(portfolioId, coinId);

  return (
    <CompoundCoinDetail
      portfolioId={portfolioId}
      coinId={coinId}
      holding={holding}
      transactions={transactions}
    />
  );
}
