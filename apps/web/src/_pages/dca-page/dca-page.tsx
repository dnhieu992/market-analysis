import Link from 'next/link';

import { createServerApiClient } from '@web/shared/auth/api-auth';
import type { DcaConfigSummary } from '@web/shared/api/types';
import { NewPlanButton } from '@web/widgets/dca-panel/new-plan-button';

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(value);
}

function DcaConfigCard({ config }: { config: DcaConfigSummary }) {
  const deployedPct =
    config.capital.totalBudget > 0
      ? Math.round((config.capital.deployedAmount / config.capital.totalBudget) * 100)
      : 0;

  return (
    <Link
      href={`/dca/${config.id}`}
      style={{ textDecoration: 'none', color: 'inherit' }}
    >
      <article className="panel" style={{ cursor: 'pointer' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ margin: 0 }}>{config.coin} DCA</h2>
            <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--muted)' }}>
              Budget {formatUsd(config.capital.totalBudget)}
              {' · '}Deployed {formatUsd(config.capital.deployedAmount)} ({deployedPct}%)
              {' · '}Remaining {formatUsd(config.capital.remaining)}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 12, fontSize: '0.82rem', marginTop: 4 }}>
            <span style={{ color: '#16a34a', fontWeight: 600 }}>
              {config.pendingBuyCount} buy
            </span>
            <span style={{ color: '#dc2626', fontWeight: 600 }}>
              {config.pendingSellCount} sell
            </span>
          </div>
        </div>
        {!config.planId && (
          <p style={{ margin: '12px 0 0', fontSize: '0.82rem', color: 'var(--muted)' }}>
            No active plan — click to generate one.
          </p>
        )}
      </article>
    </Link>
  );
}

export default async function DcaPage() {
  const api = createServerApiClient();
  const configs = await api.fetchDcaConfigs().catch(() => [] as DcaConfigSummary[]);

  return (
    <main className="dashboard-shell">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0 }}>DCA Plans</h1>
        <NewPlanButton />
      </div>

      {configs.length === 0 ? (
        <article className="panel" style={{ textAlign: 'center', padding: '2rem' }}>
          <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>
            No DCA plans yet. Create your first one.
          </p>
          <NewPlanButton />
        </article>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {configs.map((config) => (
            <DcaConfigCard key={config.id} config={config} />
          ))}
        </div>
      )}
    </main>
  );
}
