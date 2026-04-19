import { formatPrice } from '@web/shared/lib/format';
import type { DailyAnalysis } from '@web/shared/api/types';
import type { DailyAnalysisPlan } from '@app/core';

type DailyAnalysisSetup = DailyAnalysisPlan['primarySetup'];

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
  return <span className={cls}>{status.replace('_', ' ')}</span>;
}

function BiasBadge({ bias }: { bias: DailyAnalysisPlan['bias'] }) {
  const cls =
    bias === 'Bullish' ? 'dp-bias-badge dp-bias-badge--bullish' :
    bias === 'Bearish' ? 'dp-bias-badge dp-bias-badge--bearish' :
    'dp-bias-badge dp-bias-badge--neutral';
  return <span className={cls}>{bias}</span>;
}

function DirectionBadge({ direction }: { direction: DailyAnalysisSetup['direction'] }) {
  const cls =
    direction === 'long' ? 'dp-dir-badge dp-dir-badge--long' :
    direction === 'short' ? 'dp-dir-badge dp-dir-badge--short' :
    'dp-dir-badge dp-dir-badge--none';
  const label = direction === 'long' ? '▲ Long' : direction === 'short' ? '▼ Short' : '— No Trade';
  return <span className={cls}>{label}</span>;
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

function SetupRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="dp-setup-row">
      <span className="dp-setup-label">{label}</span>
      <span className="dp-setup-value">{value}</span>
    </div>
  );
}

function PrimarySetupSection({ setup, title }: { setup: DailyAnalysisSetup; title: string }) {
  if (!setup || setup.direction === 'none') return null;
  return (
    <div className="dp-setup">
      <div className="dp-setup-header">
        <span className="dp-setup-title">{title}</span>
        <DirectionBadge direction={setup.direction} />
      </div>
      <div className="dp-setup-grid">
        <SetupRow label="Trigger" value={setup.trigger} />
        <SetupRow label="Entry" value={setup.entry} />
        <SetupRow label="Stop Loss" value={setup.stopLoss} />
        <SetupRow label="Take Profit 1" value={setup.takeProfit1} />
        <SetupRow label="Take Profit 2" value={setup.takeProfit2} />
        <SetupRow label="Risk : Reward" value={setup.riskReward} />
        <SetupRow label="Invalidation" value={setup.invalidation} />
      </div>
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

  const plan = record.aiOutput ?? null;
  const hasStructural = record.d1Trend != null || record.h4Trend != null;
  const hasLevels =
    record.d1S1 != null || record.d1R1 != null ||
    record.h4S1 != null || record.h4R1 != null;
  const hasPrimarySetup = plan?.primarySetup != null && plan.primarySetup.direction !== 'none';

  return (
    <article className="daily-plan-card">
      {/* Header */}
      <header className="daily-plan-card-header">
        <span className="daily-plan-card-symbol">{record.symbol}</span>
        <StatusBadge status={record.status} />
        <span className="daily-plan-card-date">{dateLabel}</span>
      </header>

      {/* Bias + Confidence */}
      {plan?.bias && (
        <div className="dp-bias-row">
          <BiasBadge bias={plan.bias} />
          {plan.confidence != null && (
            <span className="dp-confidence">Confidence: <strong>{plan.confidence}%</strong></span>
          )}
          {plan.setupType && <span className="dp-setup-type">{plan.setupType}</span>}
        </div>
      )}

      {/* Timeframe trends */}
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

      {/* Key price levels */}
      {hasLevels && (
        <>
          <LevelsBlock label="D1" r2={record.d1R2} r1={record.d1R1} s1={record.d1S1} s2={record.d1S2} />
          <LevelsBlock label="H4" r2={record.h4R2} r1={record.h4R1} s1={record.h4S1} s2={record.h4S2} />
        </>
      )}

      {/* Primary trade setup */}
      {plan && hasPrimarySetup && (
        <PrimarySetupSection setup={plan.primarySetup} title="Primary Setup" />
      )}

      {/* Final action */}
      {plan?.finalAction && (
        <div className="dp-final-action">
          <p className="dp-final-action-label">Final Action</p>
          <p className="dp-final-action-text">{plan.finalAction}</p>
        </div>
      )}

      {/* Reasoning */}
      {Array.isArray(plan?.reasoning) && plan.reasoning.length > 0 && (
        <div className="dp-reasoning">
          <p className="dp-reasoning-label">Reasoning</p>
          <ul className="dp-reasoning-list">
            {plan.reasoning.map((item, i) => (
              <li key={i} className="dp-reasoning-item">{item}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Summary (AI analysis text) — fall back to record.summary for old records */}
      {(plan?.summary || record.summary) && (
        <div className="daily-plan-analysis">
          <p className="daily-plan-analysis-label">Summary</p>
          <pre className="daily-plan-analysis-text">{plan?.summary || record.summary}</pre>
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
