'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { PortfolioPnlCalendar } from '@web/shared/api/types';

/* ── constants ─────────────────────────────────── */

const DAYS_VI       = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const DAYS_VI_SHORT = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const MONTHS_VI     = [
  'Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4',
  'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8',
  'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12',
];

/* ── helpers ───────────────────────────────────── */

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}
function getFirstDow(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}
function fmtPnl(v: number) {
  return (v >= 0 ? '+' : '') +
    v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
type ViewMode = 'day' | 'month';

/* ── main page ─────────────────────────────────── */

export function PortfolioPnlPage({ data }: { data: PortfolioPnlCalendar }) {
  const today   = new Date();
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const [year, setYear]   = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

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

  // ── day view: group by day for current month ──
  const pnlByDay = new Map<number, number>();
  for (const entry of data.daily) {
    const d = new Date(entry.date);
    if (d.getFullYear() === year && d.getMonth() === month) {
      pnlByDay.set(d.getDate(), (pnlByDay.get(d.getDate()) ?? 0) + entry.realizedPnl);
    }
  }

  // ── month view: group by month for current year ──
  const pnlByMonth = new Map<number, number>();
  for (const entry of data.daily) {
    const d = new Date(entry.date);
    if (d.getFullYear() === year) {
      pnlByMonth.set(d.getMonth(), (pnlByMonth.get(d.getMonth()) ?? 0) + entry.realizedPnl);
    }
  }

  // ── sidebar: scope stats ──
  const scopeEntries = data.daily.filter((e) => {
    const d = new Date(e.date);
    if (viewMode === 'month') return d.getFullYear() === year;
    return d.getFullYear() === year && d.getMonth() === month;
  });
  const scopePnl     = scopeEntries.reduce((s, e) => s + e.realizedPnl, 0);
  const profitDays   = scopeEntries.filter((e) => e.realizedPnl > 0);
  const lossDays     = scopeEntries.filter((e) => e.realizedPnl < 0);
  const bestDay      = scopeEntries.reduce<{ date: string; realizedPnl: number } | null>((best, e) =>
    best == null || e.realizedPnl > best.realizedPnl ? e : best, null);
  const worstDay     = scopeEntries.reduce<{ date: string; realizedPnl: number } | null>((worst, e) =>
    worst == null || e.realizedPnl < worst.realizedPnl ? e : worst, null);

  // ── calendar cells ──
  const daysInMonth = getDaysInMonth(year, month);
  const firstDow    = getFirstDow(year, month);
  const cells: (number | null)[] = [
    ...Array<null>(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();
  const isCurrentYear  = year === today.getFullYear();

  const totalAllTime = data.daily.reduce((s, e) => s + e.realizedPnl, 0);

  return (
    <main className="pnl-cal-shell">
      {/* Page header */}
      <div className="pnl-cal-topbar">
        <div className="pnl-cal-topbar-left">
          <Link href="/" className="pnl-cal-back">← Tổng quan</Link>
          <h1 className="pnl-cal-heading">Lịch P&amp;L Portfolio</h1>
        </div>

        <div className="pnl-cal-topbar-right">
          <div className="pnl-cal-view-toggle">
            <button
              className={`pnl-cal-view-btn${viewMode === 'day' ? ' pnl-cal-view-btn--active' : ''}`}
              onClick={() => setViewMode('day')}
            >Theo ngày</button>
            <button
              className={`pnl-cal-view-btn${viewMode === 'month' ? ' pnl-cal-view-btn--active' : ''}`}
              onClick={() => setViewMode('month')}
            >Theo tháng</button>
          </div>

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

      {/* Calendar + sidebar */}
      <div className="pnl-cal-body">
        {viewMode === 'day' ? (
          <div className="pnl-cal-main">
            <div className="pnl-cal-dow-row">
              {DAYS_VI.map((d, i) => (
                <div key={d} className="pnl-cal-dow">
                  <span className="pnl-cal-dow-full">{d}</span>
                  <span className="pnl-cal-dow-short">{DAYS_VI_SHORT[i]}</span>
                </div>
              ))}
            </div>
            <div className="pnl-cal-grid">
              {cells.map((day, i) => {
                if (day === null) {
                  return <div key={`blank-${i}`} className="pnl-cal-cell pnl-cal-cell--blank" />;
                }
                const isToday = isCurrentMonth && day === today.getDate();
                const dayPnl  = pnlByDay.get(day);
                return (
                  <div key={day} className={`pnl-cal-cell${isToday ? ' pnl-cal-cell--today' : ''}`}>
                    <span className="pnl-cal-day-num">{day}</span>
                    {dayPnl !== undefined && (
                      <span className={`pnl-cal-day-pnl ${dayPnl >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
                        {fmtPnl(dayPnl)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="pnl-cal-main">
            <div className="pnl-cal-month-grid">
              {Array.from({ length: 12 }, (_, m) => {
                const isFuture  = isCurrentYear && m > today.getMonth();
                const isCurrent = isCurrentYear && m === today.getMonth();
                const mPnl      = pnlByMonth.get(m);
                return (
                  <div
                    key={m}
                    className={[
                      'pnl-cal-month-cell',
                      isFuture  ? 'pnl-cal-month-cell--future'  : '',
                      isCurrent ? 'pnl-cal-month-cell--current' : '',
                    ].join(' ').trim()}
                  >
                    <span className="pnl-cal-month-name">{MONTHS_VI[m]}</span>
                    {!isFuture && mPnl !== undefined && (
                      <span className={`pnl-cal-month-pnl ${mPnl >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
                        {fmtPnl(mPnl)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Sidebar */}
        <aside className="pnl-cal-sidebar">
          <div className="pnl-cal-stat-block">
            <p className="pnl-cal-stat-label">Realized P&amp;L {viewMode === 'month' ? `năm ${year}` : `${MONTHS_VI[month]} ${year}`}</p>
            <p className={`pnl-cal-stat-main ${scopePnl >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
              {scopeEntries.length === 0 ? '+0,00 USDT' : `${fmtPnl(scopePnl)} USDT`}
            </p>
            <hr className="pnl-cal-stat-sep" />
          </div>
          <div className="pnl-cal-stat-block">
            <p className="pnl-cal-stat-label">All-time Realized P&amp;L</p>
            <p className={`pnl-cal-stat-value ${totalAllTime >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
              {fmtPnl(totalAllTime)} USDT
            </p>
            <hr className="pnl-cal-stat-sep" />
          </div>
          <div className="pnl-cal-stat-block">
            <div className="pnl-cal-stat-pair">
              <div>
                <p className="pnl-cal-stat-label">Ngày lãi</p>
                <p className="pnl-cal-stat-value pnl-positive">{profitDays.length}</p>
              </div>
              <div>
                <p className="pnl-cal-stat-label">Ngày lỗ</p>
                <p className="pnl-cal-stat-value pnl-negative">{lossDays.length}</p>
              </div>
            </div>
            <hr className="pnl-cal-stat-sep" />
          </div>
          {bestDay && (
            <div className="pnl-cal-stat-block">
              <p className="pnl-cal-stat-label">Ngày tốt nhất</p>
              <p className="pnl-cal-stat-value pnl-positive">{fmtPnl(bestDay.realizedPnl)} USDT</p>
              <p className="pnl-cal-stat-label" style={{ fontSize: '0.72rem', marginTop: 2 }}>{bestDay.date}</p>
              <hr className="pnl-cal-stat-sep" />
            </div>
          )}
          {worstDay && (
            <div className="pnl-cal-stat-block">
              <p className="pnl-cal-stat-label">Ngày tệ nhất</p>
              <p className="pnl-cal-stat-value pnl-negative">{fmtPnl(worstDay.realizedPnl)} USDT</p>
              <p className="pnl-cal-stat-label" style={{ fontSize: '0.72rem', marginTop: 2 }}>{worstDay.date}</p>
            </div>
          )}
        </aside>
      </div>

    </main>
  );
}
