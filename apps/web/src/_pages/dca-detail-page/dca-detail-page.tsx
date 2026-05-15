import Link from 'next/link';

import { createServerApiClient } from '@web/shared/auth/api-auth';
import { DcaPanel } from '@web/widgets/dca-panel/dca-panel';

type Props = {
  configId: string;
};

export default async function DcaDetailPage({ configId }: Props) {
  const api = createServerApiClient();

  const data = await api.fetchDcaActivePlan(configId).catch(() => null);
  const portfolios = await api.fetchPortfolios().catch(() => []);

  if (!data) {
    return (
      <main className="dashboard-shell">
        <Link href="/dca" style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
          ← Back to DCA Plans
        </Link>
        <p style={{ marginTop: '1rem', color: 'var(--muted)' }}>Plan not found.</p>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <div style={{ marginBottom: '1rem' }}>
        <Link href="/dca" style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
          ← Back to DCA Plans
        </Link>
      </div>
      <DcaPanel
        config={data.config}
        plan={data.plan}
        capital={data.capital}
        portfolios={portfolios}
      />
    </main>
  );
}
