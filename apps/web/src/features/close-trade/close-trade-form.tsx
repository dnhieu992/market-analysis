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
      {entryPrice !== undefined && (
        <div className="ct-meta">
          <div className="ct-meta-item">
            <span className="ct-meta-label">Entry Price</span>
            <span className="ct-meta-value">{entryPrice.toLocaleString()}</span>
          </div>
          {side && (
            <div className="ct-meta-item">
              <span className="ct-meta-label">Side</span>
              <span className={`ct-meta-badge ct-meta-badge--${side}`}>{side}</span>
            </div>
          )}
          {quantity != null && (
            <div className="ct-meta-item ct-meta-item--right">
              <span className="ct-meta-label">Qty</span>
              <span className="ct-meta-value">{quantity}</span>
            </div>
          )}
        </div>
      )}

      <div className="ct-field">
        <label className="ct-label" htmlFor="ct-close-price">Close Price</label>
        <input
          id="ct-close-price"
          name="closePrice"
          type="number"
          min="0"
          step="any"
          placeholder="0.00"
          value={closePrice ?? ''}
          onChange={(e) => setClosePrice(e.target.value === '' ? undefined : Number(e.target.value))}
          required
          className="ct-input"
        />
      </div>

      {estimatedPnl !== null && (
        <div className={`ct-pnl ${estimatedPnl >= 0 ? 'ct-pnl--win' : 'ct-pnl--loss'}`}>
          <span className="ct-pnl__label">Estimated P&amp;L</span>
          <span className="ct-pnl__value">
            {estimatedPnl >= 0 ? '+' : ''}{estimatedPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      )}

      <div className="ct-field">
        <label className="ct-label" htmlFor="ct-closed-at">Close Date &amp; Time</label>
        <input
          id="ct-closed-at"
          name="closedAt"
          type="datetime-local"
          defaultValue={defaultClosedAt}
          required
          className="ct-input"
        />
      </div>

      <div className="ct-field">
        <label className="ct-label" htmlFor="ct-note">
          Note <span className="ct-optional">optional</span>
        </label>
        <textarea
          id="ct-note"
          name="note"
          placeholder="Add a note about this trade..."
          rows={2}
          className="ct-input ct-textarea"
        />
      </div>

      {error && <p className="ct-error">{error}</p>}

      <button type="submit" className="ct-submit" disabled={isPending}>
        {isPending ? 'Closing…' : 'Close Trade'}
      </button>
    </form>
  );
}
