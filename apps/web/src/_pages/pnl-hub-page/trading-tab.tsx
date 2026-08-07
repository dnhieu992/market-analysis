'use client';

import { useState } from 'react';
import type { DashboardOrder } from '@web/shared/api/types';
import { CalendarGrid } from './calendar-grid';
import {
  PERIOD_OPTIONS, baseCurrency, coinColor, filterByPeriod, fmtDuration, fmtPnl,
  groupOrdersByDay, groupOrdersByMonth, longestStreak, scopeOrders, type ViewMode,
} from './shared';

/* ── sub-components ────────────────────────────── */

function PeriodSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <select
      className="perf-period-select"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {PERIOD_OPTIONS.map((o) => (
        <option key={o.days} value={o.days}>{o.label}</option>
      ))}
    </select>
  );
}

function StatRow({ label, value, colored }: { label: string; value: string; colored?: boolean }) {
  const isPos = value.startsWith('+');
  const isNeg = value.startsWith('-');
  const cls = colored && isPos ? 'pnl-positive' : colored && isNeg ? 'pnl-negative' : '';
  return (
    <div className="perf-stat-row">
      <span className="perf-stat-row-label">{label}</span>
      <span className={`perf-stat-row-value ${cls}`}>{value}</span>
    </div>
  );
}

function PerformanceStats({ orders }: { orders: DashboardOrder[] }) {
  const [days, setDays] = useState(30);
  const filtered = filterByPeriod(orders, days);

  const wins   = filtered.filter((o) => (o.pnl ?? 0) > 0);
  const losses = filtered.filter((o) => (o.pnl ?? 0) < 0);
  const breakevens = filtered.filter((o) => (o.pnl ?? 0) === 0);

  const totalPnl  = filtered.reduce((s, o) => s + (o.pnl ?? 0), 0);
  const totalWin  = wins.reduce((s, o) => s + (o.pnl ?? 0), 0);
  const totalLoss = losses.reduce((s, o) => s + (o.pnl ?? 0), 0); // negative

  const n = filtered.length;
  const avgPnl   = n > 0 ? totalPnl / n : null;
  const avgWin   = wins.length > 0 ? totalWin / wins.length : null;
  const avgLoss  = losses.length > 0 ? totalLoss / losses.length : null; // negative

  const winRate  = n > 0 ? (wins.length / n) * 100 : null;
  const lossRate = n > 0 ? (losses.length / n) * 100 : null;

  const profitFactor = Math.abs(totalLoss) > 0 ? totalWin / Math.abs(totalLoss) : null;
  const expectedValue = winRate != null && avgWin != null && lossRate != null && avgLoss != null
    ? (winRate / 100) * avgWin + (lossRate / 100) * avgLoss
    : null;
  const riskReward = avgWin != null && avgLoss != null && avgLoss < 0
    ? avgWin / Math.abs(avgLoss)
    : null;

  // PnL % (need entryPrice * quantity for position value)
  function pnlPct(o: DashboardOrder) {
    const pos = (o.entryPrice ?? 0) * (o.quantity ?? 0);
    return pos > 0 ? ((o.pnl ?? 0) / pos) * 100 : null;
  }
  const pnlPcts    = filtered.map(pnlPct).filter((v): v is number => v != null);
  const winPcts    = wins.map(pnlPct).filter((v): v is number => v != null);
  const lossPcts   = losses.map(pnlPct).filter((v): v is number => v != null);
  const avgPnlPct  = pnlPcts.length > 0 ? pnlPcts.reduce((s, v) => s + v, 0) / pnlPcts.length : null;
  const avgWinPct  = winPcts.length > 0 ? winPcts.reduce((s, v) => s + v, 0) / winPcts.length : null;
  const avgLossPct = lossPcts.length > 0 ? lossPcts.reduce((s, v) => s + v, 0) / lossPcts.length : null;

  // Hold time
  function holdMs(o: DashboardOrder) {
    if (!o.closedAt || !o.openedAt) return null;
    return new Date(o.closedAt).getTime() - new Date(o.openedAt).getTime();
  }
  const allHold  = filtered.map(holdMs).filter((v): v is number => v != null && v >= 0);
  const winHold  = wins.map(holdMs).filter((v): v is number => v != null && v >= 0);
  const lossHold = losses.map(holdMs).filter((v): v is number => v != null && v >= 0);
  const avgHold  = allHold.length > 0  ? allHold.reduce((s, v) => s + v, 0) / allHold.length : null;
  const avgWinH  = winHold.length > 0  ? winHold.reduce((s, v) => s + v, 0) / winHold.length : null;
  const avgLossH = lossHold.length > 0 ? lossHold.reduce((s, v) => s + v, 0) / lossHold.length : null;

  const dash = '--';
  const fmtU = (v: number | null) => v != null ? `${fmtPnl(v)} USDT` : dash;
  const fmtP = (v: number | null) => v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : dash;
  const fmtT = (v: number | null) => v != null ? fmtDuration(v) : dash;

  return (
    <section className="perf-section">
      <div className="perf-section-header">
        <h2 className="perf-section-title">Thống kê hiệu suất</h2>
        <PeriodSelect value={days} onChange={setDays} />
      </div>

      {/* Row 1: 4 columns */}
      <div className="perf-grid perf-grid--4">
        <div className="perf-col">
          <p className="perf-col-title">PNL</p>
          <StatRow label="Tổng PNL"        value={fmtU(totalPnl)}  colored />
          <StatRow label="Tổng lợi nhuận"  value={fmtU(totalWin)}  colored />
          <StatRow label="Tổng tiền lỗ"    value={fmtU(totalLoss)} colored />
        </div>

        <div className="perf-col">
          <p className="perf-col-title">PNL trung bình</p>
          <StatRow label="PNL trung bình"      value={fmtU(avgPnl)}  colored />
          <StatRow label="Lợi nhuận trung bình" value={fmtU(avgWin)} colored />
          <StatRow label="Lỗ trung bình"        value={fmtU(avgLoss)} colored />
        </div>

        <div className="perf-col">
          <p className="perf-col-title">PNL% trung bình</p>
          <StatRow label="PNL% trung bình"                     value={fmtP(avgPnlPct)}  colored />
          <StatRow label="PNL% trung bình của vị thế thắng"    value={fmtP(avgWinPct)}  colored />
          <StatRow label="PNL% trung bình của vị thế thua"     value={fmtP(avgLossPct)} colored />
        </div>

        <div className="perf-col">
          <p className="perf-col-title">Thời gian nắm giữ</p>
          <StatRow label="TG nắm giữ TB"                               value={fmtT(avgHold)} />
          <StatRow label="Thời gian nắm giữ trung bình của vị thế thắng" value={fmtT(avgWinH)} />
          <StatRow label="Thời gian nắm giữ trung bình của vị thế thua"  value={fmtT(avgLossH)} />
        </div>
      </div>

      <div className="perf-divider" />

      {/* Row 2: 3 columns */}
      <div className="perf-grid perf-grid--3">
        <div className="perf-col">
          <p className="perf-col-title">Vị thế</p>
          <StatRow label="Số lượng vị thế đã đóng" value={String(n)} />
          <StatRow label="Số lượng vị thế thắng"   value={String(wins.length)} />
          <StatRow
            label="Số lượng vị thế thua"
            value={String(losses.length)}
            colored={losses.length > 0}
          />
          <StatRow label="Số lượng vị thế hòa vốn" value={String(breakevens.length)} />
        </div>

        <div className="perf-col">
          <p className="perf-col-title">Tỷ lệ lãi và lỗ</p>
          <StatRow label="Tỷ lệ thắng"        value={winRate  != null ? `${winRate.toFixed(2)}%`  : dash} />
          <StatRow label="Tỷ lệ thua"          value={lossRate != null ? `${lossRate.toFixed(2)}%` : dash} />
          <StatRow label="Chuỗi thắng dài nhất" value={n > 0 ? String(longestStreak(filtered, 'win'))  : dash} />
          <StatRow label="Chuỗi thua dài nhất"  value={n > 0 ? String(longestStreak(filtered, 'loss')) : dash} />
        </div>

        <div className="perf-col">
          <p className="perf-col-title">Rủi ro và phần thưởng</p>
          <StatRow label="Hệ số lợi nhuận" value={profitFactor != null ? profitFactor.toFixed(2) : dash} />
          <StatRow label="Giá trị kỳ vọng"  value={fmtU(expectedValue)} colored />
          <StatRow label="Rủi ro/lợi nhuận" value={riskReward != null ? `1 : ${riskReward.toFixed(2)}` : dash} />
        </div>
      </div>
    </section>
  );
}

function PnlBySymbol({ orders }: { orders: DashboardOrder[] }) {
  const [days, setDays] = useState(30);
  const filtered = filterByPeriod(orders, days);

  // Group by symbol
  const map = new Map<string, { total: number; long: number; short: number }>();
  for (const o of filtered) {
    const sym = o.symbol.toUpperCase();
    const existing = map.get(sym) ?? { total: 0, long: 0, short: 0 };
    const pnl = o.pnl ?? 0;
    existing.total += pnl;
    if (o.side === 'long')  existing.long  += pnl;
    if (o.side === 'short') existing.short += pnl;
    map.set(sym, existing);
  }

  const rows = Array.from(map.entries())
    .map(([symbol, v]) => ({ symbol, ...v }))
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
    .slice(0, 10)
    .sort((a, b) => b.total - a.total);

  const maxAbs = rows.length > 0 ? Math.max(...rows.map((r) => Math.abs(r.total))) : 1;

  if (rows.length === 0) return null;

  return (
    <section className="perf-section">
      <div className="perf-section-header">
        <h2 className="perf-section-title">PNL theo cặp giao dịch</h2>
        <PeriodSelect value={days} onChange={setDays} />
      </div>

      <div className="sym-table">
        {/* Header */}
        <div className="sym-table-header">
          <span className="sym-col sym-col--name">Tên</span>
          <span className="sym-col sym-col--pnl">Tổng PNL ⇅</span>
          <span className="sym-col sym-col--pnl">PNL vị thế mua ⇅</span>
          <span className="sym-col sym-col--pnl">PNL vị thế bán ⇅</span>
        </div>

        {/* Rows */}
        {rows.map((row) => {
          const base = baseCurrency(row.symbol);
          const color = coinColor(row.symbol);
          const barW = maxAbs > 0 ? (Math.abs(row.total) / maxAbs) * 100 : 0;
          const longBarW = maxAbs > 0 ? (Math.abs(row.long) / maxAbs) * 100 : 0;
          const shortBarW = maxAbs > 0 ? (Math.abs(row.short) / maxAbs) * 100 : 0;

          return (
            <div key={row.symbol} className="sym-table-row">
              <div className="sym-col sym-col--name">
                <span className="sym-icon" style={{ background: color }}>{base.slice(0, 3)}</span>
                <span className="sym-name">{row.symbol}</span>
              </div>

              <div className="sym-col sym-col--pnl" data-label="Tổng PNL">
                <div className="sym-bar-wrap">
                  <div
                    className={`sym-bar ${row.total >= 0 ? 'sym-bar--pos' : 'sym-bar--neg'}`}
                    style={{ width: `${barW}%` }}
                  />
                </div>
                <span className={`sym-pnl-val ${row.total >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
                  {fmtPnl(row.total)} USDT
                </span>
              </div>

              <div className="sym-col sym-col--pnl" data-label="Mua">
                <div className="sym-bar-wrap">
                  <div
                    className={`sym-bar ${row.long >= 0 ? 'sym-bar--pos' : 'sym-bar--neg'}`}
                    style={{ width: `${longBarW}%` }}
                  />
                </div>
                <span className={`sym-pnl-val ${row.long >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
                  {fmtPnl(row.long)} USDT
                </span>
              </div>

              <div className="sym-col sym-col--pnl" data-label="Bán">
                <div className="sym-bar-wrap">
                  <div
                    className={`sym-bar ${row.short >= 0 ? 'sym-bar--pos' : 'sym-bar--neg'}`}
                    style={{ width: `${shortBarW}%` }}
                  />
                </div>
                <span className={`sym-pnl-val ${row.short >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
                  {fmtPnl(row.short)} USDT
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ── tab ───────────────────────────────────────── */

type Props = {
  orders: DashboardOrder[];
  viewMode: ViewMode;
  year: number;
  month: number;
};

export function TradingTab({ orders, viewMode, year, month }: Props) {
  const pnlByDay   = groupOrdersByDay(orders, year, month);
  const pnlByMonth = groupOrdersByMonth(orders, year);

  const scoped    = scopeOrders(orders, viewMode, year, month);
  const totalPnl  = scoped.reduce((s, o) => s + (o.pnl ?? 0), 0);
  const wins      = scoped.filter((o) => (o.pnl ?? 0) > 0);
  const losses    = scoped.filter((o) => (o.pnl ?? 0) < 0);
  const totalWin  = wins.reduce((s, o) => s + (o.pnl ?? 0), 0);
  const totalLoss = losses.reduce((s, o) => s + Math.abs(o.pnl ?? 0), 0);
  const profitFactor = totalLoss > 0 ? totalWin / totalLoss : null;
  const winRate      = scoped.length > 0 ? (wins.length / scoped.length) * 100 : null;
  const lossRate     = scoped.length > 0 ? (losses.length / scoped.length) * 100 : null;
  const avgWin       = wins.length > 0 ? totalWin / wins.length : null;
  const avgLoss      = losses.length > 0 ? totalLoss / losses.length : null;
  const riskReward   = avgWin != null && avgLoss != null && avgLoss > 0 ? avgWin / avgLoss : null;

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
            <p className="pnl-cal-stat-label">Tổng PNL</p>
            <p className={`pnl-cal-stat-main ${totalPnl >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
              {scoped.length === 0 ? '+0,00 USDT' : `${fmtPnl(totalPnl)} USDT`}
            </p>
            <hr className="pnl-cal-stat-sep" />
          </div>
          <div className="pnl-cal-stat-block">
            <p className="pnl-cal-stat-label">Hệ số lợi nhuận</p>
            <p className="pnl-cal-stat-value">{profitFactor != null ? profitFactor.toFixed(2) : '--'}</p>
            <hr className="pnl-cal-stat-sep" />
          </div>
          <div className="pnl-cal-stat-block">
            <div className="pnl-cal-stat-pair">
              <div>
                <p className="pnl-cal-stat-label">Tỷ lệ thắng</p>
                <p className="pnl-cal-stat-value">{winRate != null ? `${winRate.toFixed(0)}%` : '--'}</p>
              </div>
              <div>
                <p className="pnl-cal-stat-label">Tỷ lệ thua</p>
                <p className="pnl-cal-stat-value">{lossRate != null ? `${lossRate.toFixed(0)}%` : '--'}</p>
              </div>
            </div>
            <hr className="pnl-cal-stat-sep" />
          </div>
          <div className="pnl-cal-stat-block">
            <p className="pnl-cal-stat-label">Rủi ro/lợi nhuận</p>
            <p className="pnl-cal-stat-value">{riskReward != null ? `1 : ${riskReward.toFixed(2)}` : '--'}</p>
          </div>
        </aside>
      </div>

      <PerformanceStats orders={orders} />
      <PnlBySymbol orders={orders} />
    </>
  );
}
