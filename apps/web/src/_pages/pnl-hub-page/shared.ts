import type { DashboardOrder } from '@web/shared/api/types';

/* ── constants ─────────────────────────────────── */

export const DAYS_VI = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
export const DAYS_VI_SHORT = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
export const MONTHS_VI = [
  'Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4',
  'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8',
  'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12',
];

export const PERIOD_OPTIONS = [
  { label: '7 ngày qua',   days: 7  },
  { label: '30 ngày qua',  days: 30 },
  { label: '3 tháng qua',  days: 90 },
  { label: 'Tất cả',       days: 0  },
];

const COIN_COLORS: Record<string, string> = {
  BTC: '#f7931a', ETH: '#627eea', BNB: '#f3ba2f', SOL: '#9945ff',
  XRP: '#346aa9', ADA: '#0033ad', DOGE: '#c2a633', DOT: '#e6007a',
};

export type ViewMode = 'day' | 'month';

/* ── tabs ──────────────────────────────────────── */
/* Deliberately NOT in pnl-hub-page.tsx: that module is `'use client'`, and a
   Server Component cannot call a plain function exported from a client module
   — only render it as a component. The route page needs `parseTab`. */

export type PnlTab = 'overview' | 'trading' | 'portfolio';

export const TABS: { key: PnlTab; label: string; heading: string }[] = [
  { key: 'overview',  label: 'Tổng hợp',  heading: 'Tổng hợp P&L' },
  { key: 'trading',   label: 'Giao dịch', heading: 'Lịch giao dịch' },
  { key: 'portfolio', label: 'Portfolio', heading: 'Lịch P&L Portfolio' },
];

/** `?tab=` value → tab key. Unknown / missing falls back to the overview tab. */
export function parseTab(raw: string | string[] | undefined): PnlTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return TABS.some((t) => t.key === value) ? (value as PnlTab) : 'overview';
}

/* ── date helpers ──────────────────────────────── */

export function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

export function getFirstDow(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

/** Day-of-month cells padded to whole weeks; `null` = blank filler cell. */
export function buildMonthCells(year: number, month: number): (number | null)[] {
  const cells: (number | null)[] = [
    ...Array<null>(getFirstDow(year, month)).fill(null),
    ...Array.from({ length: getDaysInMonth(year, month) }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/* ── formatters ────────────────────────────────── */

export function fmtPnl(v: number) {
  return (v >= 0 ? '+' : '') +
    v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtDuration(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}p`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m > 0 ? `${h}h ${m}p` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh > 0 ? `${d}ng ${rh}h` : `${d}ng`;
}

/* ── order helpers ─────────────────────────────── */

export function filterByPeriod(orders: DashboardOrder[], days: number): DashboardOrder[] {
  const closed = orders.filter((o) => o.closedAt && o.pnl != null);
  if (days === 0) return closed;
  const cutoff = new Date(Date.now() - days * 86400_000);
  return closed.filter((o) => new Date(o.closedAt!).getTime() >= cutoff.getTime());
}

export function longestStreak(orders: DashboardOrder[], type: 'win' | 'loss'): number {
  const sorted = [...orders].sort(
    (a, b) => new Date(a.closedAt!).getTime() - new Date(b.closedAt!).getTime()
  );
  let max = 0, cur = 0;
  for (const o of sorted) {
    const isWin = (o.pnl ?? 0) > 0;
    if ((type === 'win') === isWin) { cur++; max = Math.max(max, cur); }
    else cur = 0;
  }
  return max;
}

export function baseCurrency(symbol: string): string {
  return symbol.replace(/USDT$|BUSD$|USD$|BTC$|ETH$|BNB$/, '') || symbol.slice(0, 4);
}

export function coinColor(symbol: string): string {
  const base = baseCurrency(symbol).toUpperCase();
  return COIN_COLORS[base] ?? '#1f6f5b';
}

/** Realized PnL per day-of-month / per month for the calendar scope. */
export function groupOrdersByDay(orders: DashboardOrder[], year: number, month: number) {
  const map = new Map<number, number>();
  for (const o of orders) {
    if (!o.closedAt || o.pnl == null) continue;
    const d = new Date(o.closedAt);
    if (d.getFullYear() === year && d.getMonth() === month) {
      map.set(d.getDate(), (map.get(d.getDate()) ?? 0) + o.pnl);
    }
  }
  return map;
}

export function groupOrdersByMonth(orders: DashboardOrder[], year: number) {
  const map = new Map<number, number>();
  for (const o of orders) {
    if (!o.closedAt || o.pnl == null) continue;
    const d = new Date(o.closedAt);
    if (d.getFullYear() === year) {
      map.set(d.getMonth(), (map.get(d.getMonth()) ?? 0) + o.pnl);
    }
  }
  return map;
}

/** Closed orders inside the calendar scope (whole year in month view). */
export function scopeOrders(
  orders: DashboardOrder[], viewMode: ViewMode, year: number, month: number
): DashboardOrder[] {
  return orders.filter((o) => {
    if (!o.closedAt || o.pnl == null) return false;
    const d = new Date(o.closedAt);
    if (viewMode === 'month') return d.getFullYear() === year;
    return d.getFullYear() === year && d.getMonth() === month;
  });
}

/* ── portfolio daily helpers ───────────────────── */

export type DailyPnl = { date: string; realizedPnl: number };

export function groupDailyByDay(daily: DailyPnl[], year: number, month: number) {
  const map = new Map<number, number>();
  for (const entry of daily) {
    const d = new Date(entry.date);
    if (d.getFullYear() === year && d.getMonth() === month) {
      map.set(d.getDate(), (map.get(d.getDate()) ?? 0) + entry.realizedPnl);
    }
  }
  return map;
}

export function groupDailyByMonth(daily: DailyPnl[], year: number) {
  const map = new Map<number, number>();
  for (const entry of daily) {
    const d = new Date(entry.date);
    if (d.getFullYear() === year) {
      map.set(d.getMonth(), (map.get(d.getMonth()) ?? 0) + entry.realizedPnl);
    }
  }
  return map;
}

export function scopeDaily(
  daily: DailyPnl[], viewMode: ViewMode, year: number, month: number
): DailyPnl[] {
  return daily.filter((e) => {
    const d = new Date(e.date);
    if (viewMode === 'month') return d.getFullYear() === year;
    return d.getFullYear() === year && d.getMonth() === month;
  });
}

/** Sum two calendar maps key-by-key (used by the combined Overview calendar). */
export function mergeMaps(a: Map<number, number>, b: Map<number, number>) {
  const out = new Map<number, number>(a);
  for (const [k, v] of b) out.set(k, (out.get(k) ?? 0) + v);
  return out;
}
