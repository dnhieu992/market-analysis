'use client';

import { useEffect, useState } from 'react';

const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

type Props = {
  coinId: string;
  avgCost: number;
};

export function LivePriceInfo({ coinId, avgCost }: Props) {
  const [price, setPrice] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${coinId}USDT`);
        const data = (await res.json()) as { price: string };
        if (!cancelled) setPrice(parseFloat(data.price));
      } catch {
        // silently ignore — keep last known value
      }
    }

    void poll();
    const id = setInterval(() => { void poll(); }, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [coinId]);

  if (price == null || avgCost <= 0) return null;

  const changePct = ((price - avgCost) / avgCost) * 100;
  const positive = changePct >= 0;

  return (
    <p className="metric-detail" style={{ marginTop: 4, fontSize: '0.8rem' }}>
      <span style={{ color: 'var(--muted)' }}>Avg </span>
      <span>{usdFmt.format(avgCost)}</span>
      <span style={{ color: 'var(--muted)' }}> · Now </span>
      <span>{usdFmt.format(price)}</span>
      <span style={{ color: 'var(--muted)' }}> · </span>
      <span style={{ color: positive ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
        {(positive ? '+' : '') + changePct.toFixed(2) + '%'}
      </span>
    </p>
  );
}
