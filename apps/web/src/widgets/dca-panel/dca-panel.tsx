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

export function DcaPanel({ config: initialConfig, plan: initialPlan, capital: initialCapital, portfolios }: DcaPanelProps) {
  const [config, setConfig] = useState(initialConfig);
  const [plan, setPlan] = useState(initialPlan);
  const [capital, setCapital] = useState(initialCapital);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Setup form state (when no config exists)
  const [setupCoin, setSetupCoin] = useState<'BTC' | 'ETH'>('BTC');
  const [setupBudget, setSetupBudget] = useState('');
  const [setupPortfolioId, setSetupPortfolioId] = useState(portfolios[0]?.id ?? '');

  if (!config) {
    return (
      <div className="dca-panel dca-panel--setup">
        <h2>Create DCA Config</h2>
        <form
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
          <label>
            Coin
            <select value={setupCoin} onChange={(e) => setSetupCoin(e.target.value as 'BTC' | 'ETH')}>
              <option value="BTC">BTC</option>
              <option value="ETH">ETH</option>
            </select>
          </label>
          <label>
            Total Budget (USD)
            <input type="number" value={setupBudget} onChange={(e) => setSetupBudget(e.target.value)} required min="0" step="any" />
          </label>
          <label>
            Portfolio
            <select value={setupPortfolioId} onChange={(e) => setSetupPortfolioId(e.target.value)}>
              {portfolios.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={isPending}>{isPending ? 'Creating...' : 'Create'}</button>
          {error && <p className="error-text">{error}</p>}
        </form>
      </div>
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

  return (
    <div className="dca-panel">
      <h2>{config.coin}</h2>

      {capital && (
        <div className="dca-budget-bar">
          <span>Budget: ${capital.totalBudget.toLocaleString()}</span>
          <span>Deployed: ${capital.deployedAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
          <span>Remaining: ${capital.remaining.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
        </div>
      )}

      {capital && capital.runnerAmount > 0 && (
        <div className="dca-runner-bar">
          Runner: {capital.runnerAmount.toFixed(6)} {config.coin} @ avg ${capital.runnerAvgCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </div>
      )}

      {error && <p className="error-text">{error}</p>}

      {!plan && (
        <button onClick={handleGenerate} disabled={isPending}>
          {isPending ? 'Generating...' : 'Generate Plan'}
        </button>
      )}

      {plan && (
        <>
          {plan.llmAnalysis && (
            <details className="dca-analysis">
              <summary>LLM Analysis</summary>
              <p>{plan.llmAnalysis}</p>
            </details>
          )}

          <div className="dca-actions">
            <button onClick={handleReanalyze} disabled={isPending}>
              {isPending ? 'Analyzing...' : 'Re-analyze'}
            </button>
            <button onClick={handleReplan} disabled={isPending}>
              {isPending ? 'Re-planning...' : 'Re-plan'}
            </button>
          </div>

          <PlanItemsTable
            planId={plan.id}
            items={plan.items.filter((i) => !i.deletedByUser)}
            coin={config.coin}
            onRefresh={refreshPlan}
          />
        </>
      )}
    </div>
  );
}
