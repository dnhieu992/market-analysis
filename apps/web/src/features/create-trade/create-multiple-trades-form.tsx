'use client';

import { useEffect, useId, useState, useTransition } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { BackTestStrategy } from '@web/shared/api/types';

import { submitManualOrder } from './create-trade.model';

type OrderRow = {
  id: string;
  symbol: string;
  entryPrice: string;
  volume: string;
};

type CreateMultipleTradesFormProps = Readonly<{
  onSubmitted?: () => void;
}>;

function toDatetimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function newRow(): OrderRow {
  return { id: generateId(), symbol: 'BTCUSDT', entryPrice: '', volume: '' };
}

export function CreateMultipleTradesForm({ onSubmitted }: CreateMultipleTradesFormProps) {
  const formId = useId();
  const [rows, setRows] = useState<OrderRow[]>([newRow()]);
  const [side, setSide] = useState<'long' | 'short'>('short');
  const [openedAt, setOpenedAt] = useState(toDatetimeLocal(new Date()));
  const [exchange, setExchange] = useState('');
  const [broker, setBroker] = useState('BINGX');
  const [note, setNote] = useState('');
  const [strategies, setStrategies] = useState<BackTestStrategy[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ symbol: string; ok: boolean; msg?: string }[]>([]);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    createApiClient().fetchBackTestStrategies()
      .then(setStrategies)
      .catch(() => {/* ignore */});
  }, []);

  useEffect(() => {
    rows.forEach((row) => {
      if (!row.entryPrice) void fetchPrice(row.id, row.symbol);
    });
    // only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateRow(id: string, field: keyof Omit<OrderRow, 'id'>, value: string) {
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, [field]: value } : r));
  }

  async function addRow() {
    const row = newRow();
    setRows((prev) => [...prev, row]);
    await fetchPrice(row.id, row.symbol);
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  async function fetchPrice(rowId: string, symbol: string) {
    if (!symbol) return;
    try {
      const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol.toUpperCase()}`);
      const data = await res.json() as { price?: string };
      if (data.price) updateRow(rowId, 'entryPrice', data.price);
    } catch {/* ignore */}
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResults([]);

    const outcomes: { symbol: string; ok: boolean; msg?: string }[] = [];

    await Promise.all(
      rows.map(async (row) => {
        try {
          await submitManualOrder({
            symbol: row.symbol.toUpperCase(),
            side,
            entryPrice: row.entryPrice,
            volume: row.volume,
            exchange: exchange || undefined,
            broker: broker || undefined,
            openedAt: openedAt || undefined,
            note: note || undefined
          });
          outcomes.push({ symbol: row.symbol, ok: true });
        } catch (err) {
          outcomes.push({ symbol: row.symbol, ok: false, msg: err instanceof Error ? err.message : 'Failed' });
        }
      })
    );

    setResults(outcomes);
    const allOk = outcomes.every((o) => o.ok);
    if (allOk) {
      startTransition(() => {
        onSubmitted?.();
        window.location.reload();
      });
    }
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="multi-trade-form">
      {/* Common fields */}
      <div className="multi-trade-common">
        <label className="trade-field">
          <span>Side</span>
          <select value={side} onChange={(e) => setSide(e.target.value as 'long' | 'short')}>
            <option value="short">short</option>
            <option value="long">long</option>
          </select>
        </label>

        <label className="trade-field">
          <span>Opened At</span>
          <input
            type="datetime-local"
            value={openedAt}
            onChange={(e) => setOpenedAt(e.target.value)}
          />
        </label>

        <label className="trade-field">
          <span>Strategy</span>
          <select value={exchange} onChange={(e) => setExchange(e.target.value)}>
            <option value="">— none —</option>
            {strategies.map((s) => (
              <option key={s.name} value={s.name}>{s.name}</option>
            ))}
          </select>
        </label>

        <label className="trade-field">
          <span>Source</span>
          <select value={broker} onChange={(e) => setBroker(e.target.value)}>
            <option value="BINANCE">BINANCE</option>
            <option value="BINGX">BINGX</option>
            <option value="OKX">OKX</option>
          </select>
        </label>

        <label className="trade-field multi-trade-note">
          <span>Note</span>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Shared note for all orders" />
        </label>
      </div>

      {/* Per-order rows */}
      <div className="multi-trade-rows-header">
        <span>Symbol</span>
        <span>Entry Price</span>
        <span>Volume (USD)</span>
        <span></span>
      </div>

      <div className="multi-trade-rows">
        {rows.map((row) => (
          <div key={row.id} className="multi-trade-row">
            <input
              className="settings-input"
              type="text"
              placeholder="BTCUSDT"
              value={row.symbol}
              onChange={(e) => updateRow(row.id, 'symbol', e.target.value.toUpperCase())}
              onBlur={() => { void fetchPrice(row.id, row.symbol); }}
              required
            />
            <input
              className="settings-input"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={row.entryPrice}
              onChange={(e) => updateRow(row.id, 'entryPrice', e.target.value)}
              required
            />
            <input
              className="settings-input"
              type="number"
              min="0"
              step="0.01"
              placeholder="1000"
              value={row.volume}
              onChange={(e) => updateRow(row.id, 'volume', e.target.value)}
            />
            <button
              type="button"
              className="multi-trade-remove"
              onClick={() => removeRow(row.id)}
              disabled={rows.length === 1}
              aria-label="Remove row"
            >✕</button>
          </div>
        ))}
      </div>

      <button type="button" className="multi-trade-add-row" onClick={addRow}>+ Add Row</button>

      {results.length > 0 && (
        <div className="multi-trade-results">
          {results.map((r) => (
            <span key={r.symbol} className={r.ok ? 'multi-trade-result--ok' : 'multi-trade-result--err'}>
              {r.symbol}: {r.ok ? '✓' : r.msg}
            </span>
          ))}
        </div>
      )}

      {error && <p className="trade-form-error">{error}</p>}

      <button type="submit" className="trade-submit" disabled={isPending}>
        {isPending ? 'Submitting…' : `Submit ${rows.length} Order${rows.length > 1 ? 's' : ''}`}
      </button>
    </form>
  );
}
