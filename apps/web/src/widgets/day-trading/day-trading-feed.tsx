'use client';

import { useState, useEffect, useCallback } from 'react';
import { createApiClient } from '@web/shared/api/client';
import type { DayTradingSignal, DayTradingStats } from '@web/shared/api/types';

type Props = {
  initialSignals: DayTradingSignal[];
  initialStats: DayTradingStats;
};

type StatusFilter = 'ALL' | 'ACTIVE' | 'TP_HIT' | 'SL_HIT';

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  TP_HIT: 'TP Hit',
  SL_HIT: 'SL Hit',
  EXPIRED: 'Expired',
};

const STATUS_CLASS: Record<string, string> = {
  ACTIVE: 'dt-badge--active',
  TP_HIT: 'dt-badge--tp',
  SL_HIT: 'dt-badge--sl',
  EXPIRED: 'dt-badge--expired',
};

const SETUP_LABEL: Record<string, string> = {
  BREAK_RETEST: 'Break & Retest',
  LIQUIDITY_SWEEP: 'Liq. Sweep',
};

function formatPrice(p: number) {
  return p.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

function PriceCell({ label, value, modifier, sub }: { label: string; value: string; modifier?: string; sub?: string }) {
  return (
    <div className="dt-price">
      <span className="dt-price-label">{label}</span>
      <span className={`dt-price-value${modifier ? ` ${modifier}` : ''}`}>{value}</span>
      {sub && <span className="dt-price-sub">{sub}</span>}
    </div>
  );
}

function SignalCard({ signal }: { signal: DayTradingSignal }) {
  const riskPct = ((Math.abs(signal.entryPrice - signal.stopLoss) / signal.entryPrice) * 100).toFixed(2);
  const pnl = signal.pnlPercent;

  return (
    <div className="dt-card">
      <div className="dt-card-head">
        <span className="dt-symbol">{signal.symbol}</span>
        <span className={`dt-badge ${signal.direction === 'LONG' ? 'dt-badge--long' : 'dt-badge--short'}`}>
          {signal.direction}
        </span>
        <span className="dt-badge dt-badge--setup">{SETUP_LABEL[signal.setupType] ?? signal.setupType}</span>
        <span className={`dt-badge ${STATUS_CLASS[signal.status] ?? 'dt-badge--expired'}`}>
          {STATUS_LABEL[signal.status] ?? signal.status}
        </span>
        <span className={`dt-badge ${signal.mode === 'LIVE' ? 'dt-badge--live' : 'dt-badge--paper'}`}>
          {signal.mode === 'LIVE' ? 'LIVE' : 'PAPER'}
        </span>
        {pnl != null && (
          <span className={`dt-pnl ${pnl > 0 ? 'dt-pnl--pos' : 'dt-pnl--neg'}`}>
            {pnl > 0 ? '+' : ''}{(pnl * 100).toFixed(2)}%
          </span>
        )}
      </div>

      <div className="dt-prices">
        <PriceCell label="Entry" value={formatPrice(signal.entryPrice)} />
        <PriceCell label="Stop Loss" value={formatPrice(signal.stopLoss)} modifier="dt-price-value--sl" sub={`-${riskPct}%`} />
        <PriceCell label="Take Profit" value={formatPrice(signal.takeProfit)} modifier="dt-price-value--tp" />
        <PriceCell label="R:R" value={`1:${signal.rrRatio.toFixed(1)}`} modifier="dt-price-value--rr" />
      </div>

      {signal.closedPrice != null && (
        <div className="dt-closed">
          Closed @ {formatPrice(signal.closedPrice)}{signal.closedAt ? ` · ${formatTime(signal.closedAt)}` : ''}
        </div>
      )}

      <div className="dt-meta">
        Detected {formatTime(signal.detectedAt)} · Risk ${signal.riskAmount.toFixed(0)} USDT
      </div>
    </div>
  );
}

function StatCard({ label, value, modifier }: { label: string; value: string | number; modifier?: string }) {
  return (
    <div className="dt-stat">
      <div className="dt-stat-label">{label}</div>
      <div className={`dt-stat-value${modifier ? ` ${modifier}` : ''}`}>{value}</div>
    </div>
  );
}

function StatsHeader({ stats }: { stats: DayTradingStats }) {
  const totalPnlUsd = stats.totalPnlPct * 10_000;
  return (
    <div className="dt-stats">
      <StatCard label="Signals" value={stats.total} />
      <StatCard label="Active" value={stats.active} modifier="dt-stat-value--accent" />
      <StatCard label="Win Rate" value={`${stats.winRate.toFixed(1)}%`} modifier={stats.winRate >= 50 ? 'dt-stat-value--pos' : 'dt-stat-value--neg'} />
      <StatCard label="TP / SL" value={`${stats.tpHit} / ${stats.slHit}`} />
      <StatCard
        label="Total P&L"
        value={`${totalPnlUsd >= 0 ? '+' : ''}$${totalPnlUsd.toFixed(0)}`}
        modifier={totalPnlUsd >= 0 ? 'dt-stat-value--pos' : 'dt-stat-value--neg'}
      />
    </div>
  );
}

const FILTERS: { label: string; value: StatusFilter }[] = [
  { label: 'All', value: 'ALL' },
  { label: 'Active', value: 'ACTIVE' },
  { label: 'TP Hit', value: 'TP_HIT' },
  { label: 'SL Hit', value: 'SL_HIT' },
];

export function DayTradingFeed({ initialSignals, initialStats }: Props) {
  const [signals, setSignals] = useState<DayTradingSignal[]>(initialSignals);
  const [stats, setStats] = useState<DayTradingStats>(initialStats);
  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async (status: StatusFilter) => {
    setLoading(true);
    try {
      const api = createApiClient();
      const [res, newStats] = await Promise.all([
        api.fetchDayTradingSignals({ status: status === 'ALL' ? undefined : status, limit: 50 }),
        api.fetchDayTradingStats(),
      ]);
      setSignals(res.data);
      setStats(newStats);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  // Auto-refresh every 60s to pick up new signals and result updates
  useEffect(() => {
    const id = setInterval(() => { void refresh(filter); }, 60_000);
    return () => clearInterval(id);
  }, [filter, refresh]);

  const handleFilter = (f: StatusFilter) => {
    setFilter(f);
    void refresh(f);
  };

  return (
    <div className="dt-page">
      <div className="dt-header">
        <div>
          <h1 className="dt-title">Day Trading — BTCUSDT</h1>
          <p className="dt-subtitle">Break &amp; Retest · Liquidity Sweep · 15m · Paper</p>
        </div>
        <button className="dt-refresh" onClick={() => void refresh(filter)} disabled={loading}>
          {loading ? 'Loading…' : '↻ Refresh'}
        </button>
      </div>

      <StatsHeader stats={stats} />

      <div className="dt-filters">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => handleFilter(f.value)}
            className={`dt-filter${filter === f.value ? ' dt-filter--active' : ''}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {signals.length === 0 ? (
        <div className="dt-empty">
          No signals yet. The scanner checks for setups after each 15m candle close.
        </div>
      ) : (
        <div className="dt-list">
          {signals.map((s) => <SignalCard key={s.id} signal={s} />)}
        </div>
      )}
    </div>
  );
}
