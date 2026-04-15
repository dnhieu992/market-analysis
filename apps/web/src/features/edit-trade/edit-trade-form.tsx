'use client';

import { useState, useTransition, type FormEvent } from 'react';

import type { DashboardOrder } from '@web/shared/api/types';

import { parseEditOrderFormData, submitEditOrder } from './edit-trade.model';

type EditTradeFormProps = Readonly<{
  order: DashboardOrder;
  onSubmitted?: () => void;
}>;

function toDatetimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function EditTradeForm({ order, onSubmitted }: EditTradeFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const volume = order.quantity != null && order.entryPrice > 0
    ? (order.quantity * order.entryPrice).toFixed(2)
    : '';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      const form = event.currentTarget;
      const formData = new FormData(form);
      const parsed = parseEditOrderFormData(formData);
      await submitEditOrder(order.id, parsed);

      startTransition(() => {
        onSubmitted?.();
        window.location.reload();
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to update trade');
    }
  }

  return (
    <form className="trade-form" onSubmit={handleSubmit}>
      <label className="trade-field">
        <span>Symbol</span>
        <input name="symbol" type="text" defaultValue={order.symbol} required />
      </label>

      <label className="trade-field">
        <span>Side</span>
        <select name="side" defaultValue={order.side} required>
          <option value="long">long</option>
          <option value="short">short</option>
        </select>
      </label>

      <label className="trade-field">
        <span>Entry Price</span>
        <input name="entryPrice" type="number" min="0" step="0.01" defaultValue={order.entryPrice} required />
      </label>

      <label className="trade-field">
        <span>Volume (USD)</span>
        <input name="volume" type="number" min="0" step="0.01" defaultValue={volume || undefined} />
      </label>

      <label className="trade-field">
        <span>Opened At</span>
        <input name="openedAt" type="datetime-local" defaultValue={toDatetimeLocal(order.openedAt)} />
      </label>

      <label className="trade-field">
        <span>Strategy</span>
        <input name="exchange" type="text" defaultValue={order.exchange ?? ''} />
      </label>

      <label className="trade-field">
        <span>Source</span>
        <select name="broker" defaultValue={order.broker ?? 'BINGX'}>
          <option value="BINANCE">BINANCE</option>
          <option value="BINGX">BINGX</option>
          <option value="OKX">OKX</option>
        </select>
      </label>

      <label className="trade-field trade-field-wide">
        <span>Note</span>
        <textarea name="note" rows={3} defaultValue={order.note ?? ''} />
      </label>

      {error ? <p className="trade-form-error">{error}</p> : null}

      <button type="submit" className="trade-submit" disabled={isPending}>
        {isPending ? 'Saving...' : 'Save Changes'}
      </button>
    </form>
  );
}
