import Link from 'next/link';
import { notFound } from 'next/navigation';

import { createServerApiClient } from '@web/shared/auth/api-auth';
import { StrategyDetailPanel } from '@web/widgets/strategies-list/strategy-detail-panel';

type Props = {
  params: { id: string };
};

export default async function StrategyDetailRoute({ params }: Props) {
  const client = createServerApiClient();

  const strategy = await client
    .fetchTradingStrategyById(params.id)
    .catch(() => null);

  if (!strategy) notFound();

  return (
    <main className="dashboard-shell">
      <div className="strat-detail-page">
        <Link href="/strategy" className="strat-back-btn">
          ← Back to Strategies
        </Link>
        <StrategyDetailPanel strategy={strategy} />
      </div>
    </main>
  );
}
