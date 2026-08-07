'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { DashboardOrder, PortfolioPnlCalendar } from '@web/shared/api/types';
import { OverviewTab } from './overview-tab';
import { PortfolioTab } from './portfolio-tab';
import { TradingTab } from './trading-tab';
import { MONTHS_VI, type ViewMode } from './shared';

export type PnlTab = 'overview' | 'trading' | 'portfolio';

const TABS: { key: PnlTab; label: string; heading: string }[] = [
  { key: 'overview',  label: 'Tổng hợp',  heading: 'Tổng hợp P&L' },
  { key: 'trading',   label: 'Giao dịch', heading: 'Lịch giao dịch' },
  { key: 'portfolio', label: 'Portfolio', heading: 'Lịch P&L Portfolio' },
];

/** `?tab=` value → tab key. Unknown / missing falls back to the overview tab. */
export function parseTab(raw: string | string[] | undefined): PnlTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return TABS.some((t) => t.key === value) ? (value as PnlTab) : 'overview';
}

type Props = {
  orders: DashboardOrder[];
  portfolio: PortfolioPnlCalendar;
  initialTab: PnlTab;
};

export function PnlHubPage({ orders, portfolio, initialTab }: Props) {
  const today = new Date();
  const [tab, setTab]           = useState<PnlTab>(initialTab);
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const [year, setYear]         = useState(today.getFullYear());
  const [month, setMonth]       = useState(today.getMonth());

  // ── navigation guards (no future) ──
  const atFutureMonth = year > today.getFullYear() ||
    (year === today.getFullYear() && month >= today.getMonth());
  const atFutureYear  = year >= today.getFullYear();

  function prevMonth() {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else setMonth((m) => m - 1);
  }
  function nextMonth() {
    if (atFutureMonth) return;
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else setMonth((m) => m + 1);
  }
  function prevYear() { setYear((y) => y - 1); }
  function nextYear() { if (!atFutureYear) setYear((y) => y + 1); }

  // Keep the URL shareable without a server round-trip (the page refetches all
  // closed orders + exchange history, far too heavy for a tab switch).
  function selectTab(next: PnlTab) {
    setTab(next);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', next);
      window.history.replaceState(null, '', url.toString());
    }
  }

  const heading = TABS.find((t) => t.key === tab)!.heading;

  return (
    <main className="pnl-cal-shell">
      {/* Page header */}
      <div className="pnl-cal-topbar">
        <div className="pnl-cal-topbar-left">
          <Link href="/" className="pnl-cal-back">← Tổng quan</Link>
          <h1 className="pnl-cal-heading">{heading}</h1>
        </div>

        <div className="pnl-cal-topbar-right">
          {/* View mode toggle */}
          <div className="pnl-cal-view-toggle">
            <button
              className={`pnl-cal-view-btn${viewMode === 'day' ? ' pnl-cal-view-btn--active' : ''}`}
              onClick={() => setViewMode('day')}
            >
              Theo ngày
            </button>
            <button
              className={`pnl-cal-view-btn${viewMode === 'month' ? ' pnl-cal-view-btn--active' : ''}`}
              onClick={() => setViewMode('month')}
            >
              Theo tháng
            </button>
          </div>

          {/* Navigation */}
          {viewMode === 'day' ? (
            <div className="pnl-cal-nav">
              <button className="pnl-cal-nav-btn" onClick={prevMonth} aria-label="Tháng trước">◄</button>
              <span className="pnl-cal-nav-label">{MONTHS_VI[month]}</span>
              <button
                className="pnl-cal-nav-btn"
                onClick={nextMonth}
                disabled={atFutureMonth}
                aria-label="Tháng sau"
              >►</button>
              <span className="pnl-cal-nav-year">{year}</span>
            </div>
          ) : (
            <div className="pnl-cal-nav">
              <button className="pnl-cal-nav-btn" onClick={prevYear} aria-label="Năm trước">◄</button>
              <span className="pnl-cal-nav-label" style={{ minWidth: 60 }}>{year}</span>
              <button
                className="pnl-cal-nav-btn"
                onClick={nextYear}
                disabled={atFutureYear}
                aria-label="Năm sau"
              >►</button>
            </div>
          )}
        </div>
      </div>

      {/* Tab strip */}
      <div className="pnl-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`pnl-tab${tab === t.key ? ' pnl-tab--active' : ''}`}
            onClick={() => selectTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <OverviewTab
          orders={orders}
          portfolio={portfolio}
          viewMode={viewMode}
          year={year}
          month={month}
          onOpenTab={selectTab}
        />
      )}
      {tab === 'trading' && (
        <TradingTab orders={orders} viewMode={viewMode} year={year} month={month} />
      )}
      {tab === 'portfolio' && (
        <PortfolioTab data={portfolio} viewMode={viewMode} year={year} month={month} />
      )}
    </main>
  );
}
