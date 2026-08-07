'use client';

import type { DashboardOrder, PortfolioPnlCalendar } from '@web/shared/api/types';
import { CalendarGrid } from './calendar-grid';
import {
  MONTHS_VI, fmtPnl, groupDailyByDay, groupDailyByMonth, groupOrdersByDay, groupOrdersByMonth,
  mergeMaps, scopeDaily, scopeOrders, type DailyPnl, type ViewMode,
} from './shared';

type Props = {
  orders: DashboardOrder[];
  portfolio: PortfolioPnlCalendar;
  viewMode: ViewMode;
  year: number;
  month: number;
  onOpenTab: (tab: 'trading' | 'portfolio') => void;
};

function pnlClass(v: number) {
  return v >= 0 ? 'pnl-positive' : 'pnl-negative';
}

/** One clickable source summary — jumps to the tab it summarises. */
function SourceCard({
  title, subtitle, total, rows, onOpen,
}: {
  title: string;
  subtitle: string;
  total: number;
  rows: { label: string; value: string; colored?: boolean }[];
  onOpen: () => void;
}) {
  return (
    <button type="button" className="pnl-src-card" onClick={onOpen}>
      <div className="pnl-src-card-head">
        <div>
          <p className="pnl-src-card-title">{title}</p>
          <p className="pnl-src-card-sub">{subtitle}</p>
        </div>
        <span className="pnl-src-card-arrow" aria-hidden>→</span>
      </div>
      <p className={`pnl-src-card-total ${pnlClass(total)}`}>{fmtPnl(total)} USDT</p>
      <div className="pnl-src-card-rows">
        {rows.map((r) => (
          <div key={r.label} className="perf-stat-row">
            <span className="perf-stat-row-label">{r.label}</span>
            <span
              className={`perf-stat-row-value ${
                r.colored ? (r.value.startsWith('-') ? 'pnl-negative' : 'pnl-positive') : ''
              }`}
            >
              {r.value}
            </span>
          </div>
        ))}
      </div>
    </button>
  );
}

export function OverviewTab({ orders, portfolio, viewMode, year, month, onOpenTab }: Props) {
  /* ── combined calendar ── */
  const tradeByDay   = groupOrdersByDay(orders, year, month);
  const tradeByMonth = groupOrdersByMonth(orders, year);
  const pfByDay      = groupDailyByDay(portfolio.daily, year, month);
  const pfByMonth    = groupDailyByMonth(portfolio.daily, year);

  const pnlByDay   = mergeMaps(tradeByDay, pfByDay);
  const pnlByMonth = mergeMaps(tradeByMonth, pfByMonth);

  /* ── scope totals ── */
  const scopedOrders = scopeOrders(orders, viewMode, year, month);
  const scopedDaily  = scopeDaily(portfolio.daily, viewMode, year, month);

  const tradeScopePnl = scopedOrders.reduce((s, o) => s + (o.pnl ?? 0), 0);
  const pfScopePnl    = scopedDaily.reduce((s, e) => s + e.realizedPnl, 0);
  const combinedScope = tradeScopePnl + pfScopePnl;

  const scopeLabel = viewMode === 'month' ? `năm ${year}` : `${MONTHS_VI[month]} ${year}`;

  /* ── all-time totals ── */
  const closedOrders  = orders.filter((o) => o.closedAt && o.pnl != null);
  const tradeAllTime  = closedOrders.reduce((s, o) => s + (o.pnl ?? 0), 0);
  const pfAllTime     = portfolio.daily.reduce((s, e) => s + e.realizedPnl, 0);
  const combinedAll   = tradeAllTime + pfAllTime;

  /* ── trading stats (all-time) ── */
  const wins      = closedOrders.filter((o) => (o.pnl ?? 0) > 0);
  const losses    = closedOrders.filter((o) => (o.pnl ?? 0) < 0);
  const totalWin  = wins.reduce((s, o) => s + (o.pnl ?? 0), 0);
  const totalLoss = losses.reduce((s, o) => s + Math.abs(o.pnl ?? 0), 0);
  const winRate      = closedOrders.length > 0 ? (wins.length / closedOrders.length) * 100 : null;
  const profitFactor = totalLoss > 0 ? totalWin / totalLoss : null;

  /* ── portfolio stats (all-time) ── */
  const profitDays = portfolio.daily.filter((e) => e.realizedPnl > 0);
  const lossDays   = portfolio.daily.filter((e) => e.realizedPnl < 0);
  const bestDay    = portfolio.daily.reduce<DailyPnl | null>((best, e) =>
    best == null || e.realizedPnl > best.realizedPnl ? e : best, null);
  const worstDay   = portfolio.daily.reduce<DailyPnl | null>((worst, e) =>
    worst == null || e.realizedPnl < worst.realizedPnl ? e : worst, null);

  /* ── contribution split ── */
  const absSum   = Math.abs(tradeAllTime) + Math.abs(pfAllTime);
  const tradePct = absSum > 0 ? (Math.abs(tradeAllTime) / absSum) * 100 : 0;

  return (
    <>
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
            <p className="pnl-cal-stat-label">Tổng PNL {scopeLabel}</p>
            <p className={`pnl-cal-stat-main ${pnlClass(combinedScope)}`}>
              {fmtPnl(combinedScope)} USDT
            </p>
            <hr className="pnl-cal-stat-sep" />
          </div>
          <div className="pnl-cal-stat-block">
            <div className="pnl-cal-stat-pair">
              <div>
                <p className="pnl-cal-stat-label">Giao dịch</p>
                <p className={`pnl-cal-stat-value ${pnlClass(tradeScopePnl)}`}>{fmtPnl(tradeScopePnl)}</p>
              </div>
              <div>
                <p className="pnl-cal-stat-label">Portfolio</p>
                <p className={`pnl-cal-stat-value ${pnlClass(pfScopePnl)}`}>{fmtPnl(pfScopePnl)}</p>
              </div>
            </div>
            <hr className="pnl-cal-stat-sep" />
          </div>
          <div className="pnl-cal-stat-block">
            <p className="pnl-cal-stat-label">All-time kết hợp</p>
            <p className={`pnl-cal-stat-value ${pnlClass(combinedAll)}`}>{fmtPnl(combinedAll)} USDT</p>
            <hr className="pnl-cal-stat-sep" />
          </div>
          <div className="pnl-cal-stat-block">
            <p className="pnl-cal-stat-label">Tỷ trọng đóng góp</p>
            <div className="pnl-split-bar">
              <div className="pnl-split-bar-trade" style={{ width: `${tradePct}%` }} />
            </div>
            <p className="pnl-split-legend">
              <span className="pnl-split-dot pnl-split-dot--trade" /> Giao dịch {tradePct.toFixed(0)}%
              <span className="pnl-split-dot pnl-split-dot--pf" /> Portfolio {(100 - tradePct).toFixed(0)}%
            </p>
          </div>
        </aside>
      </div>

      <section className="perf-section">
        <div className="perf-section-header">
          <h2 className="perf-section-title">Tổng hợp theo nguồn (all-time)</h2>
        </div>

        <div className="pnl-src-grid">
          <SourceCard
            title="Lịch giao dịch"
            subtitle={`${closedOrders.length} vị thế đã đóng`}
            total={tradeAllTime}
            onOpen={() => onOpenTab('trading')}
            rows={[
              { label: 'Tỷ lệ thắng',     value: winRate != null ? `${winRate.toFixed(0)}%` : '--' },
              { label: 'Hệ số lợi nhuận', value: profitFactor != null ? profitFactor.toFixed(2) : '--' },
              { label: 'Thắng / Thua',    value: `${wins.length} / ${losses.length}` },
            ]}
          />

          <SourceCard
            title="Lịch P&L Portfolio"
            subtitle={`${portfolio.daily.length} ngày có realized P&L`}
            total={pfAllTime}
            onOpen={() => onOpenTab('portfolio')}
            rows={[
              { label: 'Ngày lãi / lỗ', value: `${profitDays.length} / ${lossDays.length}` },
              { label: 'Ngày tốt nhất', value: bestDay ? `${fmtPnl(bestDay.realizedPnl)} USDT` : '--', colored: true },
              { label: 'Ngày tệ nhất',  value: worstDay ? `${fmtPnl(worstDay.realizedPnl)} USDT` : '--', colored: true },
            ]}
          />
        </div>
      </section>
    </>
  );
}
