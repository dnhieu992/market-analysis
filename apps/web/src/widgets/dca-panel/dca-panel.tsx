'use client';

import { useState, useTransition } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type {
  DcaConfig,
  DcaPlan,
  DcaCapitalState,
  Portfolio
} from '@web/shared/api/types';
import { PlanItemsTable } from './plan-items-table';

type DcaPanelProps = {
  config: DcaConfig | null;
  plan: DcaPlan | null;
  capital: DcaCapitalState | null;
  portfolios: Portfolio[];
};

const api = createApiClient();

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
}

export function DcaPanel({ config: initialConfig, plan: initialPlan, capital: initialCapital, portfolios }: DcaPanelProps) {
  const [config, setConfig] = useState(initialConfig);
  const [plan, setPlan] = useState(initialPlan);
  const [capital, setCapital] = useState(initialCapital);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [setupCoin, setSetupCoin] = useState<'BTC' | 'ETH'>('BTC');
  const [setupBudget, setSetupBudget] = useState('');
  const [setupPortfolioId, setSetupPortfolioId] = useState(portfolios[0]?.id ?? '');

  if (!config) {
    return (
      <article className="panel">
        <div className="table-header">
          <div>
            <h2>Create DCA Config</h2>
            <p>Set up budget and portfolio link for a coin.</p>
          </div>
        </div>
        <form
          className="trade-form"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              try {
                const newConfig = await api.createDcaConfig({
                  coin: setupCoin,
                  totalBudget: Number(setupBudget),
                  portfolioId: setupPortfolioId
                });
                setConfig(newConfig);
                setCapital({ totalBudget: Number(setupBudget), deployedAmount: 0, remaining: Number(setupBudget), runnerAmount: 0, runnerAvgCost: 0 });
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to create config');
              }
            });
          }}
        >
          <label className="trade-field">
            <span>Coin</span>
            <select value={setupCoin} onChange={(e) => setSetupCoin(e.target.value as 'BTC' | 'ETH')}>
              <option value="BTC">BTC</option>
              <option value="ETH">ETH</option>
            </select>
          </label>
          <label className="trade-field">
            <span>Total Budget (USD)</span>
            <input type="number" value={setupBudget} onChange={(e) => setSetupBudget(e.target.value)} required min="0" step="any" placeholder="10000" />
          </label>
          <label className="trade-field trade-field-wide">
            <span>Portfolio</span>
            <select value={setupPortfolioId} onChange={(e) => setSetupPortfolioId(e.target.value)}>
              {portfolios.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          {error && <p className="trade-form-error">{error}</p>}
          <button type="submit" className="trade-submit" disabled={isPending}>
            {isPending ? 'Creating...' : 'Create Config'}
          </button>
        </form>
      </article>
    );
  }

  const refreshPlan = async () => {
    const data = await api.fetchDcaActivePlan(config.id);
    setPlan(data.plan);
    setCapital(data.capital);
  };

  const handleGenerate = () => {
    setError(null);
    startTransition(async () => {
      const result = await api.generateDcaPlan(config.id);
      if ('error' in result) {
        setError(result.error);
      } else {
        setPlan(result);
        await refreshPlan();
      }
    });
  };

  const handleReplan = () => {
    setError(null);
    startTransition(async () => {
      const result = await api.replanDca(config.id);
      if ('error' in result) {
        setError(result.error);
      } else {
        setPlan(result);
        await refreshPlan();
      }
    });
  };

  const handleReanalyze = () => {
    setError(null);
    startTransition(async () => {
      const result = await api.reanalyzeDca(config.id);
      if ('error' in result) {
        setError(result.error);
      } else {
        setPlan(result);
      }
    });
  };

  const handleDeletePlan = () => {
    if (!confirm('Delete this plan and all its zones? This cannot be undone.')) return;
    setError(null);
    startTransition(async () => {
      try {
        await api.deleteDcaActivePlan(config.id);
        setPlan(null);
        setCapital((prev) => prev ? { ...prev, deployedAmount: 0, remaining: prev.totalBudget } : prev);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete plan');
      }
    });
  };

  return (
    <article className="panel">
      {/* Panel header */}
      <div className="table-header">
        <div>
          <h2>{config.coin} DCA</h2>
          {capital && (
            <p>
              Budget&nbsp;<strong>{formatUsd(capital.totalBudget)}</strong>
              {' · '}Deployed&nbsp;<strong>{formatUsd(capital.deployedAmount)}</strong>
              {' · '}Remaining&nbsp;<strong style={{ color: 'var(--accent)' }}>{formatUsd(capital.remaining)}</strong>
              {capital.runnerAmount > 0 && (
                <> {' · '}Runner&nbsp;<strong>{capital.runnerAmount.toFixed(6)}&nbsp;{config.coin}</strong>&nbsp;@&nbsp;avg&nbsp;<strong>{formatUsd(capital.runnerAvgCost)}</strong></>
              )}
            </p>
          )}
        </div>
        <div className="table-actions">
          {plan ? (
            <>
              <button className="btn btn--secondary" onClick={handleReanalyze} disabled={isPending}>
                {isPending ? 'Analyzing…' : 'Re-analyze'}
              </button>
              <button className="btn btn--primary" onClick={handleReplan} disabled={isPending}>
                {isPending ? 'Re-planning…' : 'Re-plan'}
              </button>
              <button className="btn btn--danger" onClick={handleDeletePlan} disabled={isPending}>
                Delete Plan
              </button>
            </>
          ) : (
            <button className="btn btn--primary" onClick={handleGenerate} disabled={isPending}>
              {isPending ? 'Generating…' : 'Generate Plan'}
            </button>
          )}
        </div>
      </div>

      {error && <p className="trade-form-error" style={{ marginBottom: 12 }}>{error}</p>}

      {/* LLM Analysis */}
      {plan?.llmAnalysis && (
        <details className="dca-analysis-block" style={{ marginBottom: 16 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem', color: 'var(--muted)' }}>
            LLM Analysis
          </summary>
          <p style={{ marginTop: 8, fontSize: '0.88rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', color: 'var(--foreground)' }}>
            {plan.llmAnalysis}
          </p>
        </details>
      )}

      {/* Plan items */}
      {plan ? (
        <PlanItemsTable
          planId={plan.id}
          items={plan.items.filter((i) => !i.deletedByUser)}
          coin={config.coin}
          onRefresh={refreshPlan}
        />
      ) : (
        <p className="tt-muted" style={{ padding: '0.5rem 0' }}>
          No active plan. Click <strong>Generate Plan</strong> to create one with LLM analysis.
        </p>
      )}
    </article>
  );
}
