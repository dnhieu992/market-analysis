'use client';

import { useState, useTransition, type FormEvent } from 'react';

import { parseCreateTransactionFormData, submitCreateTransaction } from './create-transaction.model';

type CreateTransactionFormProps = Readonly<{
  portfolioId: string;
  defaultCoinId?: string;
  onSubmitted?: () => void;
}>;

function toDateInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function CreateTransactionForm({ portfolioId, defaultCoinId, onSubmitted }: CreateTransactionFormProps) {
  const [type, setType] = useState<'buy' | 'sell'>('buy');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      const form = event.currentTarget;
      const formData = new FormData(form);
      const parsed = parseCreateTransactionFormData(formData);
      await submitCreateTransaction(portfolioId, parsed);
      form.reset();
      setType('buy');
      startTransition(() => {
        onSubmitted?.();
        window.location.reload();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add transaction');
    }
  }

  return (
    <form className="trade-form" onSubmit={handleSubmit}>
      <label className="trade-field">
        <span>Coin (e.g. BTC, ETH)</span>
        <input name="coinId" type="text" placeholder="BTC" defaultValue={defaultCoinId} readOnly={!!defaultCoinId} required />
      </label>

      <label className="trade-field">
        <span>Type</span>
        <select name="type" value={type} onChange={(e) => setType(e.target.value as 'buy' | 'sell')} required>
          <option value="buy">BUY</option>
          <option value="sell">SELL</option>
        </select>
      </label>

      <label className="trade-field">
        <span>Amount</span>
        <input name="amount" type="number" min="0" step="any" placeholder="0.5" required />
      </label>

      <label className="trade-field">
        <span>Price (USD)</span>
        <input name="price" type="number" min="0" step="any" placeholder="50000" required />
      </label>

      <label className="trade-field">
        <span>Date</span>
        <input name="transactedAt" type="date" defaultValue={toDateInputValue(new Date())} />
      </label>

      {error ? <p className="trade-form-error">{error}</p> : null}

      <button type="submit" className="trade-submit" disabled={isPending}>
        {isPending ? 'Adding...' : `Add ${type.toUpperCase()} Transaction`}
      </button>
    </form>
  );
}
