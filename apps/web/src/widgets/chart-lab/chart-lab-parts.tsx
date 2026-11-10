'use client';

import type { ChartDirection, ChartSample } from '@web/shared/api/types';

import s from './chart-lab.module.css';

export const fmtPct = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`);
export const pctClass = (n: number | null | undefined) => (n == null ? '' : n > 0 ? s.pos : n < 0 ? s.neg : '');

export const fmtChartTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' })
    : 'chưa rõ thời điểm';

export const DIR_LABEL: Record<ChartDirection, string> = { LONG: 'LONG', SHORT: 'SHORT', NONE: 'Đứng ngoài' };

export function DirectionBadge({ direction }: { direction: ChartDirection | null }) {
  if (!direction) return <span className={s.badge}>Chưa gắn</span>;
  return <span className={`${s.badge} ${direction === 'LONG' ? s.badgeLong : direction === 'SHORT' ? s.badgeShort : ''}`}>{DIR_LABEL[direction]}</span>;
}

/** The user's call judged by TP/SL first touch; unlabeled charts only show whether the data is ready. */
export function ResultBadge({ sample }: { sample: ChartSample }) {
  if (sample.outcomeStatus === 'ERROR') return <span className={s.badge} title={sample.outcomeError ?? ''}>⚠ thiếu dữ liệu</span>;
  if (sample.side) {
    const r = sample.side.tpSl.result;
    if (r === 'TP') return <span className={`${s.badge} ${s.badgeWin}`}>✓ chạm TP</span>;
    if (r === 'SL') return <span className={`${s.badge} ${s.badgeLoss}`}>✗ chạm SL</span>;
    return <span className={`${s.badge} ${s.badgeWait}`}>đang chạy</span>;
  }
  if (!sample.outcome?.horizons['6']) return <span className={`${s.badge} ${s.badgeWait}`}>chờ nến</span>;
  return <span className={s.badge}>có kết quả</span>;
}
