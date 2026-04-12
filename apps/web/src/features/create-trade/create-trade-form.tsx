'use client';

import { useState, useTransition, type FormEvent } from 'react';

import {
  parseCreateOrderFormData,
  submitManualOrder
} from './create-trade.model';

type TradeFormProps = Readonly<{
  onSubmitted?: () => void;
}>;

export function TradeForm({ onSubmitted }: TradeFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      const formData = new FormData(event.currentTarget);
      const parsed = parseCreateOrderFormData(formData);
      await submitManualOrder(parsed);
      event.currentTarget.reset();

      startTransition(() => {
        onSubmitted?.();
        window.location.reload();
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to submit trade');
    }
  }

  return (
    <form className="trade-form" onSubmit={handleSubmit}>
        <label className="trade-field">
          <span>Symbol</span>
          <input name="symbol" type="text" placeholder="BTCUSDT" required />
        </label>

        <label className="trade-field">
          <span>Side</span>
          <select name="side" defaultValue="long" required>
            <option value="long">long</option>
            <option value="short">short</option>
          </select>
        </label>

        <label className="trade-field">
          <span>Entry Price</span>
          <input name="entryPrice" type="number" min="0" step="0.01" placeholder="68000" required />
        </label>

        <label className="trade-field">
          <span>Quantity</span>
          <input name="quantity" type="number" min="0" step="0.0001" placeholder="1" />
        </label>

        <label className="trade-field">
          <span>Leverage</span>
          <input name="leverage" type="number" min="0" step="0.1" placeholder="1" />
        </label>

        <label className="trade-field">
          <span>Exchange</span>
          <input name="exchange" type="text" placeholder="Binance" />
        </label>

        <label className="trade-field trade-field-wide">
          <span>Opened At</span>
          <input name="openedAt" type="datetime-local" />
        </label>

        <label className="trade-field trade-field-wide">
          <span>Note</span>
          <textarea name="note" rows={3} placeholder="Trade idea, thesis, or context" />
        </label>

        <label className="trade-field trade-field-wide">
          <span>Signal ID</span>
          <input name="signalId" type="text" placeholder="Optional signal reference" />
        </label>

        {error ? <p className="trade-form-error">{error}</p> : null}

        <button type="submit" className="trade-submit" disabled={isPending}>
          {isPending ? 'Submitting...' : 'Submit Trade'}
        </button>
      </form>
  );
}
