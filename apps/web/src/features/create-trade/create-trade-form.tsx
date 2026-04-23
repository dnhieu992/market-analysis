'use client';

import { useEffect, useState, useTransition, type FormEvent } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { BackTestStrategy } from '@web/shared/api/types';
import { ImageUpload, type ImageUploadValue } from '@web/shared/ui/image-upload/image-upload';

import { parseCreateOrderFormData, submitManualOrder } from './create-trade.model';

type TradeFormProps = Readonly<{
  onSubmitted?: () => void;
}>;

function toDatetimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatEntryPrice(value: string): string {
  const num = Number(value);
  if (isNaN(num) || value === '') return value;
  const decimals = num >= 1 ? 3 : 5;
  return parseFloat(num.toFixed(decimals)).toString();
}

export function TradeForm({ onSubmitted }: TradeFormProps) {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [entryPrice, setEntryPrice] = useState('');
  const [priceLoading, setPriceLoading] = useState(false);
  const [strategies, setStrategies] = useState<BackTestStrategy[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function fetchPrice(sym: string) {
    if (!sym) return;
    setPriceLoading(true);
    try {
      const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${sym.toUpperCase()}`);
      const data = await res.json() as { price?: string };
      if (data.price) setEntryPrice(formatEntryPrice(data.price));
    } catch {
      // silently ignore — user can type price manually
    } finally {
      setPriceLoading(false);
    }
  }

  useEffect(() => {
    void fetchPrice(symbol);
    createApiClient().fetchBackTestStrategies()
      .then(setStrategies)
      .catch(() => {/* silently ignore */});
  }, []);

  function handleSymbolBlur() {
    void fetchPrice(symbol);
  }

  function handleImageChange({ newFiles }: ImageUploadValue) {
    setPendingFiles(newFiles);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      let imageUrls: string[] = [];

      if (pendingFiles.length > 0) {
        setIsUploading(true);
        try {
          imageUrls = await createApiClient().uploadImages(pendingFiles);
        } finally {
          setIsUploading(false);
        }
      }

      const form = event.currentTarget;
      const formData = new FormData(form);
      const parsed = parseCreateOrderFormData(formData);
      await submitManualOrder(parsed, imageUrls);
      form.reset();
      setPendingFiles([]);

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
          step="any"
          placeholder="0.00"
          value={entryPrice}
          onChange={(e) => setEntryPrice(e.target.value)}
          onBlur={() => setEntryPrice(formatEntryPrice(entryPrice))}
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
          <option value="daily plan">daily plan</option>
          {strategies.map((s) => (
            <option key={s.name} value={s.name}>{s.name}</option>
          ))}
        </select>
      </label>

      <label className="trade-field">
        <span>Order Type</span>
        <select name="orderType" defaultValue="market">
          <option value="market">market</option>
          <option value="limit">limit</option>
        </select>
      </label>

      <label className="trade-field">
        <span>Source</span>
        <select name="broker" defaultValue="BINGX">
          <option value="BINANCE">BINANCE</option>
          <option value="BINGX">BINGX</option>
          <option value="BITGET">BITGET</option>
          <option value="OKX">OKX</option>
        </select>
      </label>

      <label className="trade-field trade-field-wide">
        <span>Note</span>
        <textarea name="note" rows={3} placeholder="Trade idea, thesis, or context" />
      </label>

      <div className="trade-field trade-field-wide">
        <span style={{ fontSize: '0.84rem', fontWeight: 700 }}>Screenshots</span>
        <ImageUpload
          onChange={handleImageChange}
          uploading={isUploading}
        />
      </div>

      {error ? <p className="trade-form-error">{error}</p> : null}

      <button type="submit" className="trade-submit" disabled={isPending || isUploading}>
        {isUploading ? 'Uploading images...' : isPending ? 'Submitting...' : 'Submit Trade'}
      </button>
    </form>
  );
}
