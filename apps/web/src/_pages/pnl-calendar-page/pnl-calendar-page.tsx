'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { DashboardOrder } from '@web/shared/api/types';

const DAYS_VI = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const MONTHS_VI = [
  'Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4',
  'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8',
  'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12',
];

type Props = { orders: DashboardOrder[] };

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDow(year: number, month: number) {
  return new Date(year, month, 1).getDay(); // 0=Sun
}

function fmtPnl(v: number) {
  return (v >= 0 ? '+' : '') +
    v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function PnlCalendarPage({ orders }: Props) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  function prevMonth() {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else setMonth((m) => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else setMonth((m) => m + 1);
  }

  // Group PnL by day for the displayed month
  const pnlByDay = new Map<number, number>();
  for (const o of orders) {
    if (!o.closedAt || o.pnl == null) continue;
    const d = new Date(o.closedAt);
    if (d.getFullYear() === year && d.getMonth() === month) {
      const day = d.getDate();
      pnlByDay.set(day, (pnlByDay.get(day) ?? 0) + o.pnl);
    }
  }

  // Stats for displayed month
  const monthOrders = orders.filter((o) => {
    if (!o.closedAt || o.pnl == null) return false;
    const d = new Date(o.closedAt);
    return d.getFullYear() === year && d.getMonth() === month;
  });

  const totalPnl = monthOrders.reduce((s, o) => s + (o.pnl ?? 0), 0);
  const wins = monthOrders.filter((o) => (o.pnl ?? 0) > 0);
  const losses = monthOrders.filter((o) => (o.pnl ?? 0) < 0);
  const totalWin = wins.reduce((s, o) => s + (o.pnl ?? 0), 0);
  const totalLoss = losses.reduce((s, o) => s + Math.abs(o.pnl ?? 0), 0);

  const profitFactor = totalLoss > 0 ? totalWin / totalLoss : null;
  const winRate = monthOrders.length > 0 ? (wins.length / monthOrders.length) * 100 : null;
  const lossRate = monthOrders.length > 0 ? (losses.length / monthOrders.length) * 100 : null;
  const avgWin = wins.length > 0 ? totalWin / wins.length : null;
  const avgLoss = losses.length > 0 ? totalLoss / losses.length : null;
  const riskReward = avgWin != null && avgLoss != null && avgLoss > 0 ? avgWin / avgLoss : null;

  // Build calendar cells
  const daysInMonth = getDaysInMonth(year, month);
  const firstDow = getFirstDow(year, month);
  const cells: (number | null)[] = [
    ...Array<null>(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();

  return (
    <main className="pnl-cal-shell">
      {/* Page header */}
      <div className="pnl-cal-topbar">
        <div className="pnl-cal-topbar-left">
          <Link href="/" className="pnl-cal-back">← Tổng quan</Link>
          <h1 className="pnl-cal-heading">Lịch giao dịch</h1>
        </div>
        <div className="pnl-cal-nav">
          <button className="pnl-cal-nav-btn" onClick={prevMonth} aria-label="Tháng trước">◄</button>
          <span className="pnl-cal-nav-label">{MONTHS_VI[month]}</span>
          <button className="pnl-cal-nav-btn" onClick={nextMonth} aria-label="Tháng sau">►</button>
          <span className="pnl-cal-nav-year">{year}</span>
        </div>
      </div>

      {/* Body: calendar + sidebar */}
      <div className="pnl-cal-body">
        {/* Calendar */}
        <div className="pnl-cal-main">
          {/* Day-of-week header */}
          <div className="pnl-cal-dow-row">
            {DAYS_VI.map((d) => (
              <div key={d} className="pnl-cal-dow">{d}</div>
            ))}
          </div>
          {/* Date grid */}
          <div className="pnl-cal-grid">
            {cells.map((day, i) => {
              if (day === null) {
                return <div key={`blank-${i}`} className="pnl-cal-cell pnl-cal-cell--blank" />;
              }
              const isToday = isCurrentMonth && day === today.getDate();
              const dayPnl = pnlByDay.get(day);
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

        {/* Sidebar */}
        <aside className="pnl-cal-sidebar">
          <div className="pnl-cal-stat-block">
            <p className="pnl-cal-stat-label">Tổng PNL</p>
            <p className={`pnl-cal-stat-main ${totalPnl >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
              {monthOrders.length === 0
                ? '+0,00 USDT'
                : `${fmtPnl(totalPnl)} USDT`}
            </p>
            <hr className="pnl-cal-stat-sep" />
          </div>

          <div className="pnl-cal-stat-block">
            <p className="pnl-cal-stat-label">Hệ số lợi nhuận</p>
            <p className="pnl-cal-stat-value">
              {profitFactor != null ? profitFactor.toFixed(2) : '--'}
            </p>
            <hr className="pnl-cal-stat-sep" />
          </div>

          <div className="pnl-cal-stat-block">
            <div className="pnl-cal-stat-pair">
              <div>
                <p className="pnl-cal-stat-label">Tỷ lệ thắng</p>
                <p className="pnl-cal-stat-value">
                  {winRate != null ? `${winRate.toFixed(0)}%` : '--'}
                </p>
              </div>
              <div>
                <p className="pnl-cal-stat-label">Tỷ lệ thua</p>
                <p className="pnl-cal-stat-value">
                  {lossRate != null ? `${lossRate.toFixed(0)}%` : '--'}
                </p>
              </div>
            </div>
            <hr className="pnl-cal-stat-sep" />
          </div>

          <div className="pnl-cal-stat-block">
            <p className="pnl-cal-stat-label">Rủi ro/lợi nhuận</p>
            <p className="pnl-cal-stat-value">
              {riskReward != null ? `1 : ${riskReward.toFixed(2)}` : '--'}
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
