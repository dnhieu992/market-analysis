'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { createApiClient } from '@web/shared/api/client';

const api = createApiClient();

type NewPlanModalProps = {
  onClose: () => void;
};

export function NewPlanModal({ onClose }: NewPlanModalProps) {
  const router = useRouter();
  const [coin, setCoin] = useState<'BTC' | 'ETH'>('BTC');
  const [portfolioName, setPortfolioName] = useState('');
  const [budget, setBudget] = useState('');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const config = await api.createDcaConfig({
          coin,
          portfolioName: portfolioName.trim(),
          totalBudget: Number(budget)
        });
        router.push(`/dca/${config.id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create plan');
      }
    });
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">New DCA Plan</span>
          <button className="dialog-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="dialog-body">
          <form className="trade-form" onSubmit={handleSubmit}>
            <label className="trade-field">
              <span>Coin</span>
              <select value={coin} onChange={(e) => setCoin(e.target.value as 'BTC' | 'ETH')}>
                <option value="BTC">BTC</option>
                <option value="ETH">ETH</option>
              </select>
            </label>
            <label className="trade-field">
              <span>Portfolio Name</span>
              <input
                type="text"
                value={portfolioName}
                onChange={(e) => setPortfolioName(e.target.value)}
                required
                placeholder="BTC DCA 2026"
              />
            </label>
            <label className="trade-field">
              <span>Budget (USD)</span>
              <input
                type="number"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                required
                min="0"
                step="any"
                placeholder="10000"
              />
            </label>
            {error && <p className="trade-form-error">{error}</p>}
            <button type="submit" className="trade-submit" disabled={isPending}>
              {isPending ? 'Creating…' : 'Create Plan'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
