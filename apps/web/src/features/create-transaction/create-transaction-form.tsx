'use client';

import { useState, useTransition, useRef, type FormEvent } from 'react';

import { parseCreateTransactionFormData, submitCreateTransaction } from './create-transaction.model';

type CreateTransactionFormProps = Readonly<{
  portfolioId: string;
  defaultCoinId?: string;
  defaultPrice?: number;
  onSubmitted?: () => void;
}>;

function toDateInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function fetchCoinPrice(coinId: string): Promise<number | null> {
  if (!coinId.trim()) return null;
  try {
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${coinId.toUpperCase()}USDT`);
    const data = await res.json() as { price?: string };
    return data.price ? Number(data.price) : null;
  } catch {
    return null;
  }
}

export function CreateTransactionForm({ portfolioId, defaultCoinId, defaultPrice, onSubmitted }: CreateTransactionFormProps) {
  const [type, setType] = useState<'buy' | 'sell'>('buy');
  const [coinId, setCoinId] = useState(defaultCoinId ?? '');
  const [price, setPrice] = useState<string>(defaultPrice != null ? String(defaultPrice) : '');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const priceRef = useRef<HTMLInputElement>(null);

  async function handleCoinBlur() {
    if (!coinId.trim() || price) return;
    const fetched = await fetchCoinPrice(coinId);
    if (fetched != null) setPrice(String(fetched));
  }

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
      setCoinId(defaultCoinId ?? '');
      setPrice('');
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
      {/* Type tabs */}
      <div className="tx-type-tabs">
        <button
          type="button"
          className={`tx-type-tab${type === 'buy' ? ' tx-type-tab--buy' : ''}`}
          onClick={() => setType('buy')}
        >
          Buy
        </button>
        <button
          type="button"
          className={`tx-type-tab${type === 'sell' ? ' tx-type-tab--sell' : ''}`}
          onClick={() => setType('sell')}
        >
          Sell
        </button>
      </div>
      {/* Hidden input so form still submits type */}
      <input type="hidden" name="type" value={type} />

      <label className="trade-field">
        <span>Coin (e.g. BTC, ETH)</span>
        <input
          name="coinId"
          type="text"
          placeholder="BTC"
          value={coinId}
          readOnly={!!defaultCoinId}
          required
          onChange={(e) => setCoinId(e.target.value.toUpperCase())}
          onBlur={() => { void handleCoinBlur(); }}
        />
      </label>

      <label className="trade-field">
        <span>Amount</span>
        <input name="amount" type="number" min="0" step="any" placeholder="0.5" required />
      </label>

      <label className="trade-field">
        <span>Price (USD)</span>
        <input
          ref={priceRef}
          name="price"
          type="number"
          min="0"
          step="any"
          placeholder="50000"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          required
        />
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
