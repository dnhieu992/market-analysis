import type { ChartSample } from '@web/shared/api/types';

/** ISO → value of <input type="datetime-local"> (browser local time), and back. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null);

export function fmtDate(iso: string | null): string {
  if (!iso) return '–';
  return new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtPrice(n: number | null): string {
  if (n == null) return '–';
  return n.toLocaleString('en-US', { maximumFractionDigits: n >= 1 ? 4 : 8 });
}

export const fmtZone = (s: Pick<ChartSample, 'entryZone' | 'entryPrice' | 'entryPriceTo'>): string =>
  s.entryZone ? s.entryZone : s.entryPrice == null ? '–' : s.entryPriceTo != null ? `${fmtPrice(s.entryPrice)} – ${fmtPrice(s.entryPriceTo)}` : fmtPrice(s.entryPrice);

/** "1,234.5" / "1 234,5" / "" → number | null. */
export function parsePrice(v: string): number | null {
  const t = v.trim().replace(/\s/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export const priceStr = (n: number | null | undefined) => (n != null ? String(n) : '');
