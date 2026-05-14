'use client';

import { useState, useTransition } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { DcaPlanItem } from '@web/shared/api/types';

type ExecuteModalProps = {
  item: DcaPlanItem;
  coin: string;
  planId: string;
  onClose: () => void;
  onDone: () => Promise<void>;
};

const api = createApiClient();

export function ExecuteModal({ item, coin, planId, onClose, onDone }: ExecuteModalProps) {
  const [price, setPrice] = useState(String(item.targetPrice));
  const [amount, setAmount] = useState('');
  const [executedAt, setExecutedAt] = useState('');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      try {
        await api.executeDcaPlanItem(planId, item.id, {
          executedPrice: Number(price),
          executedAmount: Number(amount),
          ...(executedAt ? { executedAt: new Date(executedAt).toISOString() } : {})
        });
        await onDone();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to execute');
      }
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3>Execute {item.type.toUpperCase()} @ ${item.targetPrice.toLocaleString()}</h3>
        <form onSubmit={handleSubmit}>
          <label>
            Actual Price (USD)
            <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} required min="0" step="any" />
          </label>
          <label>
            Actual Amount ({coin})
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required min="0" step="any" />
          </label>
          <label>
            Executed At (optional)
            <input type="datetime-local" value={executedAt} onChange={(e) => setExecutedAt(e.target.value)} />
          </label>
          {error && <p className="error-text">{error}</p>}
          <div className="modal-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" disabled={isPending}>{isPending ? 'Executing...' : 'Confirm'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
