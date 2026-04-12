import { formatPrice } from '@web/shared/lib/format';
import type { DailyAnalysis } from '@web/shared/api/types';

function TrendBadge({ trend }: { trend: 'bullish' | 'bearish' | 'neutral' }) {
  const label = trend.charAt(0).toUpperCase() + trend.slice(1);
  const className =
    trend === 'bullish'
      ? 'trend-badge trend-badge--bullish'
      : trend === 'bearish'
        ? 'trend-badge trend-badge--bearish'
        : 'trend-badge trend-badge--neutral';
  return <span className={className}>{label}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'TRADE_READY'
      ? 'back-test-outcome back-test-outcome--win'
      : status === 'NO_TRADE'
        ? 'back-test-outcome back-test-outcome--loss'
        : status === 'PUBLISHED'
          ? 'back-test-outcome back-test-outcome--win'
          : 'back-test-outcome back-test-outcome--breakeven';
  return <span className={cls}>{status}</span>;
}

function LevelsBlock({
  label,
  r2, r1, s1, s2
}: {
  label: string;
  r2: number | null; r1: number | null;
  s1: number | null; s2: number | null;
}) {
  if (r2 == null && r1 == null && s1 == null && s2 == null) return null;
  return (
    <div className="daily-plan-levels">
      <span className="daily-plan-levels-label">{label}</span>
      <span className="daily-plan-levels-grid">
        {r2 != null && <span className="level level--resistance">R2 {formatPrice(r2)}</span>}
        {r1 != null && <span className="level level--resistance">R1 {formatPrice(r1)}</span>}
        {s1 != null && <span className="level level--support">S1 {formatPrice(s1)}</span>}
        {s2 != null && <span className="level level--support">S2 {formatPrice(s2)}</span>}
      </span>
    </div>
  );
}

function DailyPlanCard({ record }: { record: DailyAnalysis }) {
  const dateLabel = new Date(record.date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  });

  const analysisText = record.summary || '';
  const hasStructural = record.d1Trend != null || record.h4Trend != null;
  const hasLevels =
    record.d1S1 != null || record.d1R1 != null ||
    record.h4S1 != null || record.h4R1 != null;

  return (
    <article className="daily-plan-card">
      <header className="daily-plan-card-header">
        <span className="daily-plan-card-date">{dateLabel}</span>
        <span className="daily-plan-card-symbol">{record.symbol}</span>
        <StatusBadge status={record.status} />
      </header>

      {hasStructural && (
        <div className="daily-plan-trends">
          {record.d1Trend && (
            <span className="daily-plan-trend-item">
              D1: <TrendBadge trend={record.d1Trend} />
            </span>
          )}
          {record.h4Trend && (
            <span className="daily-plan-trend-item">
              H4: <TrendBadge trend={record.h4Trend} />
            </span>
          )}
        </div>
      )}

      {hasLevels && (
        <>
          <LevelsBlock
            label="D1"
            r2={record.d1R2} r1={record.d1R1}
            s1={record.d1S1} s2={record.d1S2}
          />
          <LevelsBlock
            label="H4"
            r2={record.h4R2} r1={record.h4R1}
            s1={record.h4S1} s2={record.h4S2}
          />
        </>
      )}

      {analysisText && (
        <div className="daily-plan-analysis">
          <p className="daily-plan-analysis-label">AI Analysis</p>
          <pre className="daily-plan-analysis-text">{analysisText}</pre>
        </div>
      )}

      <footer className="daily-plan-card-footer">
        <span className="daily-plan-meta">{record.llmModel || record.llmProvider}</span>
      </footer>
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
          <h1>Daily Analysis</h1>
          <p className="lead">
            AI-powered H4 chart analysis with trading plan, updated each day at 07:00 ICT.
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
