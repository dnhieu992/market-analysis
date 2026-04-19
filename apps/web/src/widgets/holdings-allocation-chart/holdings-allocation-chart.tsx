'use client';

import { useEffect, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

type HoldingEntry = {
  coinId: string;
  totalAmount: number;
  totalCost: number;
};

type ChartEntry = {
  name: string;
  value: number;
  pct: number;
};

const COLORS = [
  '#1a1f2e', '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#f97316', '#6366f1', '#84cc16',
  '#ec4899', '#14b8a6', '#a855f7', '#eab308', '#64748b',
];

async function fetchPrices(coinIds: string[]): Promise<Record<string, number>> {
  if (coinIds.length === 0) return {};
  try {
    const symbols = JSON.stringify(coinIds.map((c) => `${c}USDT`));
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbols=${encodeURIComponent(symbols)}`);
    const data = await res.json() as { symbol: string; price: string }[];
    const map: Record<string, number> = {};
    for (const item of data) {
      map[item.symbol.replace('USDT', '')] = Number(item.price);
    }
    return map;
  } catch {
    return {};
  }
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
}

type Props = { holdings: HoldingEntry[] };

export function HoldingsAllocationChart({ holdings }: Props) {
  const [data, setData] = useState<ChartEntry[]>([]);
  const [totalValue, setTotalValue] = useState(0);

  useEffect(() => {
    if (holdings.length === 0) return;

    const stableCoins = new Set(['USDT', 'USDC', 'BUSD', 'DAI', 'TUSD']);

    fetchPrices(holdings.filter((h) => !stableCoins.has(h.coinId)).map((h) => h.coinId))
      .then((prices) => {
        const entries = holdings.map((h) => {
          const price = stableCoins.has(h.coinId) ? 1 : (prices[h.coinId] ?? 0);
          const value = price > 0 ? h.totalAmount * price : h.totalCost;
          return { coinId: h.coinId, value };
        });

        const total = entries.reduce((s, e) => s + e.value, 0);
        setTotalValue(total);

        const chart: ChartEntry[] = entries
          .map((e) => ({
            name: e.coinId,
            value: e.value,
            pct: total > 0 ? (e.value / total) * 100 : 0,
          }))
          .sort((a, b) => b.value - a.value);

        setData(chart);
      });
  }, [holdings]);

  if (holdings.length === 0) return null;

  const renderLegend = () => (
    <div className="alloc-legend">
      {data.map((entry, i) => (
        <div key={entry.name} className="alloc-legend-item">
          <span className="alloc-legend-dot" style={{ background: COLORS[i % COLORS.length] }} />
          <span className="alloc-legend-name">{entry.name}</span>
          <span className="alloc-legend-pct">{entry.pct.toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );

  return (
    <section className="alloc-card">
      <div className="alloc-header">
        <div>
          <h2 className="alloc-title">Holdings Allocation</h2>
          <p className="alloc-sub">Percent of total value by asset.</p>
        </div>
        <div className="alloc-total">
          <span className="alloc-total-label">Total value</span>
          <strong className="alloc-total-value">{formatUsd(totalValue)}</strong>
        </div>
      </div>

      <div className="alloc-body">
        <div className="alloc-chart-wrap">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={0}
                outerRadius={100}
                dataKey="value"
                strokeWidth={1}
                stroke="#fff"
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value) => [formatUsd(Number(value)), '']}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {renderLegend()}
      </div>
    </section>
  );
}
