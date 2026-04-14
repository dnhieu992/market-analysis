'use client';

import { useEffect, useState, useTransition, type FormEvent } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { BackTestStrategy } from '@web/shared/api/types';

import { parseCreateOrderFormData, submitManualOrder } from './create-trade.model';

type TradeFormProps = Readonly<{
  onSubmitted?: () => void;
}>;

function toDatetimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function TradeForm({ onSubmitted }: TradeFormProps) {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [entryPrice, setEntryPrice] = useState('');
  const [priceLoading, setPriceLoading] = useState(false);
  const [strategies, setStrategies] = useState<BackTestStrategy[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function fetchPrice(sym: string) {
    if (!sym) return;
    setPriceLoading(true);
    try {
      const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${sym.toUpperCase()}`);
      const data = await res.json() as { price?: string };
      if (data.price) setEntryPrice(data.price);
    } catch {
      // silently ignore — user can type price manually
    } finally {
      setPriceLoading(false);
    }
  }

  useEffect(() => {
    void fetchPrice(symbol);

    const client = createApiClient();
    client.fetchBackTestStrategies()
      .then(setStrategies)
      .catch(() => {/* silently ignore */});
  }, []);

  function handleSymbolBlur() {
    void fetchPrice(symbol);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      const form = event.currentTarget;
      const formData = new FormData(form);
      const parsed = parseCreateOrderFormData(formData);
      await submitManualOrder(parsed);
      form.reset();

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
        <input
          name="symbol"
          type="text"
          placeholder="BTCUSDT"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          onBlur={handleSymbolBlur}
          required
        />
      </label>

      <label className="trade-field">
        <span>Side</span>
        <select name="side" defaultValue="short" required>
          <option value="long">long</option>
          <option value="short">short</option>
        </select>
      </label>

      <label className="trade-field">
        <span>Entry Price {priceLoading && <span className="trade-price-loading">fetching…</span>}</span>
        <input
          name="entryPrice"
          type="number"
          min="0"
          step="0.01"
          placeholder="0.00"
          value={entryPrice}
          onChange={(e) => setEntryPrice(e.target.value)}
          required
        />
      </label>

      <label className="trade-field">
        <span>Volume (USD)</span>
        <input name="volume" type="number" min="0" step="0.01" placeholder="1000" />
      </label>

      <label className="trade-field">
        <span>Opened At</span>
        <input name="openedAt" type="datetime-local" defaultValue={toDatetimeLocal(new Date())} />
      </label>

      <label className="trade-field">
        <span>Strategy</span>
        <select name="exchange">
          <option value="">— none —</option>
          {strategies.map((s) => (
            <option key={s.name} value={s.name}>{s.name}</option>
          ))}
        </select>
      </label>

      <label className="trade-field trade-field-wide">
        <span>Note</span>
        <textarea name="note" rows={3} placeholder="Trade idea, thesis, or context" />
      </label>

      {error ? <p className="trade-form-error">{error}</p> : null}

      <button type="submit" className="trade-submit" disabled={isPending}>
        {isPending ? 'Submitting...' : 'Submit Trade'}
      </button>
    </form>
  );
}
