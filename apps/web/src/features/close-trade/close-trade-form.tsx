'use client';

import { useState, useEffect, useTransition, type FormEvent } from 'react';

import {
  parseCloseOrderFormData,
  submitCloseOrder
} from './close-trade.model';

type CloseTradeFormProps = Readonly<{
  orderId: string;
  status: string;
  defaultClosePrice?: number;
  entryPrice?: number;
  quantity?: number | null;
  side?: string;
  onSubmitted?: () => void;
}>;

function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function CloseTradeForm({ orderId, status, defaultClosePrice, entryPrice, quantity, side, onSubmitted }: CloseTradeFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [closePrice, setClosePrice] = useState<number | undefined>(defaultClosePrice);

  useEffect(() => {
    if (defaultClosePrice !== undefined) setClosePrice(defaultClosePrice);
  }, [defaultClosePrice]);

  const estimatedPnl =
    closePrice !== undefined && entryPrice !== undefined
      ? side === 'short'
        ? (entryPrice - closePrice) * (quantity ?? 1)
        : (closePrice - entryPrice) * (quantity ?? 1)
      : null;

  if (status.toLowerCase() !== 'open') {
    return null;
  }

  const defaultClosedAt = toDatetimeLocalValue(new Date());

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      const form = event.currentTarget;
      const formData = new FormData(form);
      const parsed = parseCloseOrderFormData(formData);
      await submitCloseOrder(orderId, parsed);
      form.reset();

      startTransition(() => {
        onSubmitted?.();
        window.location.reload();
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to close trade');
    }
  }

  return (
    <form className="close-trade-form" onSubmit={handleSubmit}>
      <label className="trade-field">
        <span>Close Price</span>
        <input
          name="closePrice"
          type="number"
          min="0"
          step="0.01"
          placeholder="69000"
          value={closePrice ?? ''}
          onChange={(e) => setClosePrice(e.target.value === '' ? undefined : Number(e.target.value))}
          required
        />
      </label>

      {estimatedPnl !== null && (
        <div className={`estimated-pnl ${estimatedPnl >= 0 ? 'estimated-pnl--positive' : 'estimated-pnl--negative'}`}>
          <span className="estimated-pnl__label">Estimated P&amp;L</span>
          <span className="estimated-pnl__value">
            {estimatedPnl >= 0 ? '+' : ''}{estimatedPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      )}

      <label className="trade-field">
        <span>Close Date &amp; Time</span>
        <input
          name="closedAt"
          type="datetime-local"
          defaultValue={defaultClosedAt}
          required
        />
      </label>

      <label className="trade-field">
        <span>Note</span>
        <input name="note" type="text" placeholder="Optional close note" />
      </label>

      {error ? <p className="trade-form-error">{error}</p> : null}

      <button type="submit" className="trade-submit trade-submit-secondary" disabled={isPending}>
        {isPending ? 'Closing...' : 'Close Trade'}
      </button>
    </form>
  );
}
