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

type TopHolding = {
  coinId: string;
  value: number;
  change24h: number;
};

const COLORS = [
  '#1a1f2e', '#6b7280', '#9ca3af', '#d1d5db',
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#f97316', '#6366f1',
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

async function fetch24hChanges(coinIds: string[]): Promise<Record<string, number>> {
  if (coinIds.length === 0) return {};
  try {
    const symbols = JSON.stringify(coinIds.map((c) => `${c}USDT`));
    const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(symbols)}`);
    const data = await res.json() as { symbol: string; priceChangePercent: string }[];
    const map: Record<string, number> = {};
    for (const item of data) {
      map[item.symbol.replace('USDT', '')] = Number(item.priceChangePercent);
    }
    return map;
  } catch {
    return {};
  }
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

type Props = { holdings: HoldingEntry[] };

export function HoldingsAllocationChart({ holdings }: Props) {
  const [data, setData] = useState<ChartEntry[]>([]);
  const [topHoldings, setTopHoldings] = useState<TopHolding[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (holdings.length === 0) return;

    const stableCoins = new Set(['USDT', 'USDC', 'BUSD', 'DAI', 'TUSD']);
    const nonStable = holdings.filter((h) => !stableCoins.has(h.coinId)).map((h) => h.coinId);

    Promise.all([fetchPrices(nonStable), fetch24hChanges(nonStable)])
      .then(([prices, changes]) => {
        const entries = holdings.map((h) => {
          const price = stableCoins.has(h.coinId) ? 1 : (prices[h.coinId] ?? 0);
          const value = price > 0 ? h.totalAmount * price : h.totalCost;
          const change24h = stableCoins.has(h.coinId) ? 0 : (changes[h.coinId] ?? 0);
          return { coinId: h.coinId, value, change24h };
        });

        const total = entries.reduce((s, e) => s + e.value, 0);

        // Group small holdings into "Other"
        const sorted = [...entries].sort((a, b) => b.value - a.value);
        const TOP_COUNT = 4;
        const topEntries = sorted.slice(0, TOP_COUNT);
        const otherEntries = sorted.slice(TOP_COUNT);
        const otherValue = otherEntries.reduce((s, e) => s + e.value, 0);

        const chart: ChartEntry[] = topEntries.map((e) => ({
          name: e.coinId,
          value: e.value,
          pct: total > 0 ? (e.value / total) * 100 : 0,
        }));

        if (otherValue > 0) {
          chart.push({
            name: 'Other',
            value: otherValue,
            pct: total > 0 ? (otherValue / total) * 100 : 0,
          });
        }

        setData(chart);

        // Top 3 holdings for the list
        setTopHoldings(
          sorted.slice(0, 3).map((e) => ({
            coinId: e.coinId,
            value: e.value,
            change24h: e.change24h,
          }))
        );

        setLoaded(true);
      });
  }, [holdings]);

  if (holdings.length === 0) return null;

  return (
    <section className="alloc-card">
      {/* Asset Allocation: donut + legend side by side */}
      <h3 className="alloc-section-title">Asset Allocation</h3>
      <div className="alloc-donut-row">
        <div className="alloc-chart-wrap">
          {loaded && data.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={72}
                  dataKey="value"
                  strokeWidth={2}
                  stroke="var(--background-elevated, #1a1a2e)"
                >
                  {data.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value) => [
                    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(value)),
                    '',
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <span className="tt-muted" style={{ fontSize: '0.8rem' }}>loading…</span>
          )}
        </div>

        <div className="alloc-legend">
          {data.map((entry, i) => (
            <div key={entry.name} className="alloc-legend-item">
              <span className="alloc-legend-dot" style={{ background: COLORS[i % COLORS.length] }} />
              <span className="alloc-legend-name">{entry.name}</span>
              <span className="alloc-legend-pct">{Math.round(entry.pct)}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* Divider */}
      <div className="alloc-divider" />

      {/* Top Holdings */}
      <h3 className="alloc-section-title">Top Holdings</h3>
      <div className="alloc-top-list">
        {topHoldings.map((h, i) => {
          const isPositive = h.change24h >= 0;
          return (
            <div key={h.coinId} className="alloc-top-row">
              <span className="alloc-top-rank">{i + 1}</span>
              <span className="alloc-top-coin">{h.coinId}</span>
              <span className="alloc-top-value">{formatUsd(h.value)}</span>
              <span className={`alloc-top-change ${isPositive ? 'alloc-top-change--up' : 'alloc-top-change--down'}`}>
                {isPositive ? '+' : ''}{h.change24h.toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
