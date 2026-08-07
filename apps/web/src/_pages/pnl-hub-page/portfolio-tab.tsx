'use client';

import type { PortfolioPnlCalendar } from '@web/shared/api/types';
import { CalendarGrid } from './calendar-grid';
import {
  MONTHS_VI, fmtPnl, groupDailyByDay, groupDailyByMonth, scopeDaily, type DailyPnl, type ViewMode,
} from './shared';

type Props = {
  data: PortfolioPnlCalendar;
  viewMode: ViewMode;
  year: number;
  month: number;
};

export function PortfolioTab({ data, viewMode, year, month }: Props) {
  const pnlByDay   = groupDailyByDay(data.daily, year, month);
  const pnlByMonth = groupDailyByMonth(data.daily, year);

  const scopeEntries = scopeDaily(data.daily, viewMode, year, month);
  const scopePnl     = scopeEntries.reduce((s, e) => s + e.realizedPnl, 0);
  const profitDays   = scopeEntries.filter((e) => e.realizedPnl > 0);
  const lossDays     = scopeEntries.filter((e) => e.realizedPnl < 0);
  const bestDay      = scopeEntries.reduce<DailyPnl | null>((best, e) =>
    best == null || e.realizedPnl > best.realizedPnl ? e : best, null);
  const worstDay     = scopeEntries.reduce<DailyPnl | null>((worst, e) =>
    worst == null || e.realizedPnl < worst.realizedPnl ? e : worst, null);

  const totalAllTime = data.daily.reduce((s, e) => s + e.realizedPnl, 0);

  return (
    <div className="pnl-cal-body">
      <CalendarGrid
        viewMode={viewMode}
        year={year}
        month={month}
        pnlByDay={pnlByDay}
        pnlByMonth={pnlByMonth}
      />

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
  );
}
