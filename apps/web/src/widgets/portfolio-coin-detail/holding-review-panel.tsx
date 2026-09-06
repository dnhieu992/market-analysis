'use client';

import { useEffect, useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { HoldingReview, ReviewZone } from '@web/shared/api/types';
import { formatCryptoPrice } from '@web/shared/lib/format';
import { reviewAgeDays, shortReviewDate, verdictStyle } from '@web/shared/lib/holding-review';

type HoldingReviewPanelProps = Readonly<{
  portfolioId: string;
  coinId: string;
}>;

/** `metrics` is free-form JSON from the review; render only the keys we know. */
function MetricsLine({ metrics }: { metrics: Record<string, unknown> | null }) {
  if (!metrics) return null;

  const num = (key: string): number | null => {
    const value = Number(metrics[key]);
    return Number.isFinite(value) ? value : null;
  };
  const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;

  const parts: string[] = [];
  if (typeof metrics.trend === 'string') parts.push(`D1 ${metrics.trend}`);
  const rsi = num('rsi14');
  if (rsi != null) parts.push(`RSI ${rsi.toFixed(1)}`);
  for (const [key, label] of [['change7d', '7d'], ['change30d', '30d'], ['change90d', '90d']] as const) {
    const value = num(key);
    if (value != null) parts.push(`${label} ${signed(value)}`);
  }
  const toHigh = num('distanceTo90dHighPct');
  if (toHigh != null) parts.push(`cách đỉnh 90d ${signed(toHigh)}`);

  if (parts.length === 0) return null;
  return (
    <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: '0.4rem' }}>
      {parts.join(' · ')}
    </div>
  );
}

function ZoneRow({ label, color, zones }: { label: string; color: string; zones: ReviewZone[] }) {
  if (zones.length === 0) return null;
  return (
    <div style={{ fontSize: '0.85rem', marginTop: '0.35rem', display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'baseline' }}>
      <span style={{ color, fontWeight: 600 }}>{label}</span>
      {zones.map((zone, index) => (
        <code
          key={`${zone.low}-${zone.high}-${index}`}
          style={{ background: 'rgba(128,128,128,0.12)', padding: '0.1rem 0.35rem', borderRadius: 6, whiteSpace: 'nowrap' }}
        >
          {formatCryptoPrice(zone.low)}–{formatCryptoPrice(zone.high)}
          {zone.distancePct != null && (
            <span style={{ color: 'var(--muted)' }}> ({zone.distancePct >= 0 ? '+' : ''}{zone.distancePct.toFixed(1)}%)</span>
          )}
        </code>
      ))}
    </div>
  );
}

/**
 * The daily 00:00 UTC Claude review for this coin: today's verdict in full, with
 * the earlier ones collapsed underneath. The same analysis that goes to Telegram
 * — here so the trader can read it against the position instead of scrolling a chat.
 */
export function HoldingReviewPanel({ portfolioId, coinId }: HoldingReviewPanelProps) {
  const [reviews, setReviews] = useState<HoldingReview[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    createApiClient()
      .fetchCoinReviewHistory(portfolioId, coinId)
      .then((rows) => { if (!cancelled) setReviews(rows); })
      .catch(() => { if (!cancelled) setReviews([]); });
    return () => { cancelled = true; };
  }, [portfolioId, coinId]);

  // Still loading, or the review has never covered this coin — say nothing rather
  // than show an empty panel on a page that is useful without it.
  if (reviews == null || reviews.length === 0) return null;

  const [latest, ...older] = reviews as [HoldingReview, ...HoldingReview[]];
  const style = verdictStyle(latest.verdict);
  const ageDays = reviewAgeDays(latest.reviewDate);

  return (
    <article className="panel" style={{ marginBottom: '1rem' }}>
      <div className="table-header">
        <h2 style={{ margin: 0 }}>
          Đánh giá của Claude
          <span style={{ marginLeft: '0.5rem', color: 'var(--muted)', fontWeight: 500, fontSize: '0.9rem' }}>
            {shortReviewDate(latest.reviewDate)}
            {ageDays > 1 && ` · ${ageDays} ngày trước`}
          </span>
        </h2>
        {older.length > 0 && (
          <div className="table-actions">
            <button className="btn btn--secondary" onClick={() => setHistoryOpen((open) => !open)}>
              {historyOpen ? 'Ẩn lịch sử' : `Lịch sử (${older.length})`}
            </button>
          </div>
        )}
      </div>

      <div style={{ padding: '0 1rem 1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
              padding: '0.25rem 0.6rem', borderRadius: 999,
              fontSize: '0.95rem', fontWeight: 700,
              color: style.color, background: style.background, border: `1px solid ${style.color}33`,
            }}
          >
            {style.emoji} {latest.verdict}
          </span>
          {latest.changed && latest.previousVerdict && (
            <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>đổi từ {latest.previousVerdict}</span>
          )}
          {latest.price != null && (
            <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
              giá lúc review {formatCryptoPrice(latest.price)}
            </span>
          )}
        </div>

        {latest.reason && (
          <p style={{ margin: '0.6rem 0 0', lineHeight: 1.55 }}>{latest.reason}</p>
        )}
        <MetricsLine metrics={latest.metrics} />
        <ZoneRow label="🟩 Mua" color="#22c55e" zones={latest.buyZones} />
        <ZoneRow label="🟥 Bán" color="#ef4444" zones={latest.sellZones} />

        {historyOpen && older.length > 0 && (
          <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
            {older.map((review) => {
              const past = verdictStyle(review.verdict);
              return (
                <div key={review.reviewDate} style={{ display: 'flex', gap: '0.6rem', padding: '0.4rem 0', alignItems: 'baseline' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--muted)', minWidth: '3.2rem', flexShrink: 0 }}>
                    {shortReviewDate(review.reviewDate)}
                  </span>
                  <span style={{ color: past.color, fontWeight: 600, fontSize: '0.85rem', minWidth: '6rem', flexShrink: 0 }}>
                    {past.emoji} {review.verdict}
                  </span>
                  <span style={{ fontSize: '0.85rem', color: 'var(--muted)', lineHeight: 1.5 }}>
                    {review.reason ?? '—'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </article>
  );
}
