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

function toDateTimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function ExecuteModal({ item, coin, planId, onClose, onDone }: ExecuteModalProps) {
  const [price, setPrice] = useState(String(item.targetPrice));
  const [amount, setAmount] = useState('');
  const [executedAt, setExecutedAt] = useState(toDateTimeLocal(new Date()));
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      try {
        await api.executeDcaPlanItem(planId, item.id, {
          executedPrice: Number(price),
          executedAmount: Number(amount),
          executedAt: new Date(executedAt).toISOString()
        });
        await onDone();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to execute');
      }
    });
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">
            Execute {item.type.toUpperCase()} — Target&nbsp;
            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(item.targetPrice)}
          </span>
          <button className="dialog-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="dialog-body">
          <form className="trade-form" onSubmit={handleSubmit}>
            <label className="trade-field">
              <span>Actual Price (USD)</span>
              <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} required min="0" step="any" />
            </label>
            <label className="trade-field">
              <span>Actual Amount ({coin})</span>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required min="0" step="any" placeholder="0.001" />
            </label>
            <label className="trade-field trade-field-wide">
              <span>Executed At</span>
              <input type="datetime-local" value={executedAt} onChange={(e) => setExecutedAt(e.target.value)} required />
            </label>
            {error && <p className="trade-form-error">{error}</p>}
            <button type="submit" className="trade-submit" disabled={isPending}>
              {isPending ? 'Confirming…' : 'Confirm Execution'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
