import { formatPrice } from '@web/shared/lib/format';
import type { DailyAnalysis } from '@web/shared/api/types';

type TrendBadgeProps = Readonly<{ trend: DailyAnalysis['d1Trend'] }>;

function TrendBadge({ trend }: TrendBadgeProps) {
  const label = trend.charAt(0).toUpperCase() + trend.slice(1);
  const className =
    trend === 'bullish'
      ? 'trend-badge trend-badge--bullish'
      : trend === 'bearish'
        ? 'trend-badge trend-badge--bearish'
        : 'trend-badge trend-badge--neutral';
  return <span className={className}>{label}</span>;
}

type LevelRowProps = Readonly<{
  label: string;
  r2: number;
  r1: number;
  s1: number;
  s2: number;
}>;

function LevelRow({ label, r2, r1, s1, s2 }: LevelRowProps) {
  return (
    <div className="daily-plan-levels">
      <span className="daily-plan-levels-label">{label}</span>
      <span className="daily-plan-levels-grid">
        <span className="level level--resistance">R2 {formatPrice(r2)}</span>
        <span className="level level--resistance">R1 {formatPrice(r1)}</span>
        <span className="level level--support">S1 {formatPrice(s1)}</span>
        <span className="level level--support">S2 {formatPrice(s2)}</span>
      </span>
    </div>
  );
}

type DailyPlanCardProps = Readonly<{ record: DailyAnalysis }>;

function DailyPlanCard({ record }: DailyPlanCardProps) {
  const dateLabel = new Date(record.date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  });

  return (
    <article className="daily-plan-card">
      <header className="daily-plan-card-header">
        <span className="daily-plan-card-date">{dateLabel}</span>
        <span className="daily-plan-card-symbol">{record.symbol}</span>
      </header>

      <div className="daily-plan-trends">
        <span className="daily-plan-trend-item">
          D1: <TrendBadge trend={record.d1Trend} />
        </span>
        <span className="daily-plan-trend-item">
          H4: <TrendBadge trend={record.h4Trend} />
        </span>
      </div>

      <LevelRow
        label="D1"
        r2={record.d1R2}
        r1={record.d1R1}
        s1={record.d1S1}
        s2={record.d1S2}
      />
      <LevelRow
        label="H4"
        r2={record.h4R2}
        r1={record.h4R1}
        s1={record.h4S1}
        s2={record.h4S2}
      />

      <details className="daily-plan-summary">
        <summary>Plan details</summary>
        <pre className="daily-plan-summary-text">{record.summary}</pre>
      </details>
    </article>
  );
}

type DailyPlanFeedProps = Readonly<{
  records: DailyAnalysis[];
}>;

export function DailyPlanFeed({ records }: DailyPlanFeedProps) {
  return (
    <main className="dashboard-shell daily-plan-shell">
      <section className="hero-card daily-plan-hero">
        <div className="hero-copy">
          <p className="eyebrow">Daily Plan</p>
          <h1>BTC Daily Analysis</h1>
          <p className="lead">
            D1 and H4 trend direction with nearest support and resistance levels, updated each day at 07:00.
          </p>
        </div>
      </section>

      <section className="daily-plan-list">
        {records.length === 0 ? (
          <p className="daily-plan-empty">No daily plans yet.</p>
        ) : (
          records.map((record) => <DailyPlanCard key={record.id} record={record} />)
        )}
      </section>
    </main>
  );
}
