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

type ComputedData = {
  totalValue: number;
  totalCost: number;
  change24hUsd: number;
  change24hPct: number;
  chart: ChartEntry[];
  topHoldings: TopHolding[];
  holdingCount: number;
  cashValue: number;
};

const COLORS = [
  '#1a1f2e', '#6b7280', '#9ca3af', '#d1d5db',
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#f97316', '#6366f1',
];

const STABLE_COINS = new Set(['USDT', 'USDC', 'BUSD', 'DAI', 'TUSD']);

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

async function fetch24hTickers(coinIds: string[]): Promise<Record<string, { changeUsd: number; changePct: number }>> {
  if (coinIds.length === 0) return {};
  try {
    const symbols = JSON.stringify(coinIds.map((c) => `${c}USDT`));
    const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(symbols)}`);
    const data = await res.json() as { symbol: string; priceChange: string; priceChangePercent: string }[];
    const map: Record<string, { changeUsd: number; changePct: number }> = {};
    for (const item of data) {
      map[item.symbol.replace('USDT', '')] = {
        changeUsd: Number(item.priceChange),
        changePct: Number(item.priceChangePercent),
      };
    }
    return map;
  } catch {
    return {};
  }
}

function formatUsd(value: number, decimals = 2): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: decimals }).format(value);
}

type Props = {
  holdings: HoldingEntry[];
  portfolioCount: number;
};

export function HoldingsAllocationChart({ holdings, portfolioCount }: Props) {
  const [computed, setComputed] = useState<ComputedData | null>(null);

  useEffect(() => {
    if (holdings.length === 0) {
      setComputed({
        totalValue: 0, totalCost: 0, change24hUsd: 0, change24hPct: 0,
        chart: [], topHoldings: [], holdingCount: 0, cashValue: 0,
      });
      return;
    }

    const nonStableIds = holdings.filter((h) => !STABLE_COINS.has(h.coinId)).map((h) => h.coinId);

    Promise.all([fetchPrices(nonStableIds), fetch24hTickers(nonStableIds)])
      .then(([prices, tickers]) => {
        let cashValue = 0;

        const entries = holdings.map((h) => {
          const isStable = STABLE_COINS.has(h.coinId);
          const price = isStable ? 1 : (prices[h.coinId] ?? 0);
          const value = price > 0 ? h.totalAmount * price : h.totalCost;
          const ticker = isStable ? null : tickers[h.coinId];
          const change24h = ticker?.changePct ?? 0;
          const change24hUsd = ticker ? ticker.changeUsd * h.totalAmount : 0;

          if (isStable) cashValue += value;

          return { coinId: h.coinId, value, change24h, change24hUsd };
        });

        const totalValue = entries.reduce((s, e) => s + e.value, 0);
        const totalCost = holdings.reduce((s, h) => s + h.totalCost, 0);
        const change24hUsd = entries.reduce((s, e) => s + e.change24hUsd, 0);
        const prevValue = totalValue - change24hUsd;
        const change24hPct = prevValue > 0 ? (change24hUsd / prevValue) * 100 : 0;

        const sorted = [...entries].sort((a, b) => b.value - a.value);

        // Chart: top 4 + Other
        const TOP_COUNT = 4;
        const topEntries = sorted.slice(0, TOP_COUNT);
        const otherValue = sorted.slice(TOP_COUNT).reduce((s, e) => s + e.value, 0);

        const chart: ChartEntry[] = topEntries.map((e) => ({
          name: e.coinId,
          value: e.value,
          pct: totalValue > 0 ? (e.value / totalValue) * 100 : 0,
        }));

        if (otherValue > 0) {
          chart.push({
            name: 'Other',
            value: otherValue,
            pct: totalValue > 0 ? (otherValue / totalValue) * 100 : 0,
          });
        }

        setComputed({
          totalValue,
          totalCost,
          change24hUsd,
          change24hPct,
          chart,
          topHoldings: sorted.slice(0, 3).map((e) => ({
            coinId: e.coinId,
            value: e.value,
            change24h: e.change24h,
          })),
          holdingCount: holdings.length,
          cashValue,
        });
      });
  }, [holdings]);

  const d = computed;
  const allTimePnl = d ? d.totalValue - d.totalCost : 0;
  const allTimePnlPct = d && d.totalCost > 0 ? (allTimePnl / d.totalCost) * 100 : 0;
  const isPnlPositive = allTimePnl >= 0;
  const is24hPositive = d ? d.change24hUsd >= 0 : true;

  return (
    <section className="ps-card">
      {/* ── Left: Portfolio Summary ── */}
      <div className="ps-left">
        <p className="ps-eyebrow">Total Net Worth · All Portfolios</p>
        <h2 className="ps-net-worth">
          {d ? formatUsd(d.totalValue) : '—'}
        </h2>

        {d && (
          <div className="ps-badges">
            <span className={`ps-badge ${is24hPositive ? 'ps-badge--up' : 'ps-badge--down'}`}>
              {is24hPositive ? '▲' : '▼'} {is24hPositive ? '+' : ''}{formatUsd(d.change24hUsd)}
            </span>
            <span className={`ps-badge ${is24hPositive ? 'ps-badge--up' : 'ps-badge--down'}`}>
              {is24hPositive ? '+' : ''}{d.change24hPct.toFixed(2)}% · 24h
            </span>
          </div>
        )}

        <div className="ps-pnl-section">
          <p className="ps-eyebrow">All-Time P&amp;L</p>
          <p className={`ps-pnl-value ${isPnlPositive ? 'ps-pnl--up' : 'ps-pnl--down'}`}>
            {isPnlPositive ? '+' : ''}{formatUsd(allTimePnl)}
            <span className="ps-pnl-pct">
              ({isPnlPositive ? '+' : ''}{allTimePnlPct.toFixed(1)}%)
            </span>
          </p>
        </div>

        <div className="ps-stat-row">
          <div className="ps-stat-box">
            <span className="ps-stat-label">Portfolios</span>
            <span className="ps-stat-value">{portfolioCount}</span>
          </div>
          <div className="ps-stat-box">
            <span className="ps-stat-label">Holdings</span>
            <span className="ps-stat-value">{d?.holdingCount ?? 0}</span>
          </div>
          <div className="ps-stat-box">
            <span className="ps-stat-label">Cash</span>
            <span className="ps-stat-value">{d ? formatUsd(d.cashValue, 0) : '—'}</span>
          </div>
        </div>
      </div>

      {/* ── Right: Allocation + Top Holdings ── */}
      <div className="ps-right">
        {/* Asset Allocation */}
        <h3 className="ps-section-title">Asset Allocation</h3>
        <div className="ps-donut-row">
          <div className="ps-chart-wrap">
            {d && d.chart.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={d.chart}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={72}
                    dataKey="value"
                    strokeWidth={2}
                    stroke="var(--background-elevated, #1a1a2e)"
                  >
                    {d.chart.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => [formatUsd(Number(v)), '']} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <span className="tt-muted" style={{ fontSize: '0.8rem' }}>
                {d ? 'No data' : 'loading…'}
              </span>
            )}
          </div>

          <div className="ps-legend">
            {d?.chart.map((entry, i) => (
              <div key={entry.name} className="ps-legend-item">
                <span className="ps-legend-dot" style={{ background: COLORS[i % COLORS.length] }} />
                <span className="ps-legend-name">{entry.name}</span>
                <span className="ps-legend-pct">{Math.round(entry.pct)}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className="ps-divider" />

        {/* Top Holdings */}
        <h3 className="ps-section-title">Top Holdings</h3>
        <div className="ps-top-list">
          {d?.topHoldings.map((h, i) => {
            const up = h.change24h >= 0;
            return (
              <div key={h.coinId} className="ps-top-row">
                <span className="ps-top-rank">{i + 1}</span>
                <span className="ps-top-coin">{h.coinId}</span>
                <span className="ps-top-value">{formatUsd(h.value, 0)}</span>
                <span className={`ps-top-change ${up ? 'ps-top-change--up' : 'ps-top-change--down'}`}>
                  {up ? '+' : ''}{h.change24h.toFixed(1)}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
