'use client';

import {
  DAYS_VI, DAYS_VI_SHORT, MONTHS_VI, buildMonthCells, fmtPnl, type ViewMode,
} from './shared';

type Props = {
  viewMode: ViewMode;
  year: number;
  month: number;
  /** day-of-month → PnL */
  pnlByDay: Map<number, number>;
  /** month index → PnL */
  pnlByMonth: Map<number, number>;
};

/** The calendar surface shared by all three tabs — only the numbers differ. */
export function CalendarGrid({ viewMode, year, month, pnlByDay, pnlByMonth }: Props) {
  const today = new Date();
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();
  const isCurrentYear  = year === today.getFullYear();

  if (viewMode === 'month') {
    return (
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
    );
  }

  const cells = buildMonthCells(year, month);

  return (
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
  );
}
