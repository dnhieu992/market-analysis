'use client';

import { useState, useTransition, type FormEvent } from 'react';

import {
  parseCloseOrderFormData,
  submitCloseOrder
} from './close-trade.model';

type CloseTradeFormProps = Readonly<{
  orderId: string;
  status: string;
  onSubmitted?: () => void;
}>;

export function CloseTradeForm({ orderId, status, onSubmitted }: CloseTradeFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (status.toLowerCase() !== 'open') {
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      const formData = new FormData(event.currentTarget);
      const parsed = parseCloseOrderFormData(formData);
      await submitCloseOrder(orderId, parsed);
      event.currentTarget.reset();

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
        <input name="closePrice" type="number" min="0" step="0.01" placeholder="69000" required />
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
