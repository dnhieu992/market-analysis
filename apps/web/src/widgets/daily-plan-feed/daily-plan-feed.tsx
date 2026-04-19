'use client';

import { useState } from 'react';
import { formatPrice } from '@web/shared/lib/format';
import type { DailyAnalysis } from '@web/shared/api/types';
import type { DailyAnalysisPlan } from '@app/core';

type DailyAnalysisSetup = DailyAnalysisPlan['primarySetup'];

/* ── small UI atoms ────────────────────────────────────────── */

function TrendBadge({ trend }: { trend: 'bullish' | 'bearish' | 'neutral' }) {
  const label = trend.charAt(0).toUpperCase() + trend.slice(1);
  const cls =
    trend === 'bullish' ? 'trend-badge trend-badge--bullish' :
    trend === 'bearish' ? 'trend-badge trend-badge--bearish' :
    'trend-badge trend-badge--neutral';
  return <span className={cls}>{label}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'TRADE_READY' ? 'back-test-outcome back-test-outcome--win' :
    status === 'NO_TRADE'    ? 'back-test-outcome back-test-outcome--loss' :
    status === 'PUBLISHED'   ? 'back-test-outcome back-test-outcome--win' :
    'back-test-outcome back-test-outcome--breakeven';
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
    direction === 'long'  ? 'dp-dir-badge dp-dir-badge--long' :
    direction === 'short' ? 'dp-dir-badge dp-dir-badge--short' :
    'dp-dir-badge dp-dir-badge--none';
  const label =
    direction === 'long' ? '▲ Long' :
    direction === 'short' ? '▼ Short' : '— No Trade';
  return <span className={cls}>{label}</span>;
}

/* ── generic labeled cell ──────────────────────────────────── */

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? 'dp-field dp-field--full' : 'dp-field'}>
      <span className="dp-field-label">{label}</span>
      <div className="dp-field-value">{children}</div>
    </div>
  );
}

/* ── price levels (D1 / H4) ────────────────────────────────── */

function LevelsBlock({
  label, r2, r1, s1, s2,
}: {
  label: string;
  r2: number | null; r1: number | null;
  s1: number | null; s2: number | null;
}) {
  if (r2 == null && r1 == null && s1 == null && s2 == null) return null;
  return (
    <Field label={`${label} Levels`} full>
      <div className="daily-plan-levels-grid">
        {r2 != null && <span className="level level--resistance">R2 {formatPrice(r2)}</span>}
        {r1 != null && <span className="level level--resistance">R1 {formatPrice(r1)}</span>}
        {s1 != null && <span className="level level--support">S1 {formatPrice(s1)}</span>}
        {s2 != null && <span className="level level--support">S2 {formatPrice(s2)}</span>}
      </div>
    </Field>
  );
}

/* ── collapsible pre-formatted text ───────────────────────── */

function ScrollableText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="dp-scrolltext-wrap">
      <pre
        className="dp-scrolltext"
        style={{ maxHeight: expanded ? 'none' : '220px' }}
      >
        {text}
      </pre>
      {text.length > 300 && (
        <button
          className="dp-scrolltext-toggle"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Show less ▲' : 'Show more ▼'}
        </button>
      )}
    </div>
  );
}

/* ── card ──────────────────────────────────────────────────── */

function DailyPlanCard({ record }: { record: DailyAnalysis }) {
  const dateLabel = new Date(record.date).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  });

  const plan: DailyAnalysisPlan | null = record.aiOutput ?? null;
  const setup: DailyAnalysisSetup | null =
    plan?.primarySetup?.direction && plan.primarySetup.direction !== 'none'
      ? plan.primarySetup
      : null;
  const summaryText = plan?.summary || record.summary || '';
  const hasLevels =
    record.d1S1 != null || record.d1R1 != null ||
    record.h4S1 != null || record.h4R1 != null;

  return (
    <article className="daily-plan-card">

      {/* ── header row ── */}
      <div className="dp-card-header">
        <div className="dp-card-title">
          <span className="daily-plan-card-symbol">{record.symbol}</span>
          <StatusBadge status={record.status} />
        </div>
        <span className="daily-plan-card-date">{dateLabel}</span>
      </div>

      {/* ── 2-col grid of fields ── */}
      <div className="dp-card-grid">

        {/* Bias */}
        {plan?.bias && (
          <Field label="Bias">
            <BiasBadge bias={plan.bias} />
          </Field>
        )}

        {/* Confidence */}
        {plan?.confidence != null && (
          <Field label="Confidence">
            <strong>{plan.confidence}%</strong>
          </Field>
        )}

        {/* D1 trend */}
        {record.d1Trend && (
          <Field label="D1 Trend">
            <TrendBadge trend={record.d1Trend} />
          </Field>
        )}

        {/* H4 trend */}
        {record.h4Trend && (
          <Field label="H4 Trend">
            <TrendBadge trend={record.h4Trend} />
          </Field>
        )}

        {/* Setup type */}
        {plan?.setupType && (
          <Field label="Setup Type">
            <span className="dp-setup-type">{plan.setupType}</span>
          </Field>
        )}

        {/* Direction */}
        {setup && (
          <Field label="Direction">
            <DirectionBadge direction={setup.direction} />
          </Field>
        )}

        {/* Price levels – full width */}
        {hasLevels && (
          <>
            <LevelsBlock label="D1" r2={record.d1R2} r1={record.d1R1} s1={record.d1S1} s2={record.d1S2} />
            <LevelsBlock label="H4" r2={record.h4R2} r1={record.h4R1} s1={record.h4S1} s2={record.h4S2} />
          </>
        )}

        {/* Trade setup fields */}
        {setup && (
          <>
            <Field label="Entry" full>{setup.entry}</Field>
            <Field label="Stop Loss">{setup.stopLoss}</Field>
            <Field label="Take Profit 1">{setup.takeProfit1}</Field>
            <Field label="Take Profit 2">{setup.takeProfit2}</Field>
            <Field label="Risk : Reward">{setup.riskReward}</Field>
            <Field label="Trigger" full>{setup.trigger}</Field>
            <Field label="Invalidation" full>{setup.invalidation}</Field>
          </>
        )}

        {/* Final action – full width */}
        {plan?.finalAction && (
          <Field label="Final Action" full>{plan.finalAction}</Field>
        )}

        {/* Reasoning – full width */}
        {Array.isArray(plan?.reasoning) && plan.reasoning.length > 0 && (
          <Field label="Reasoning" full>
            <ul className="dp-reasoning-list">
              {plan.reasoning.map((item, i) => (
                <li key={i} className="dp-reasoning-item">{item}</li>
              ))}
            </ul>
          </Field>
        )}

        {/* Summary text – full width, collapsible */}
        {summaryText && (
          <Field label="Summary" full>
            <ScrollableText text={summaryText} />
          </Field>
        )}

      </div>

      <footer className="daily-plan-card-footer">
        <span className="daily-plan-meta">{record.llmModel || record.llmProvider}</span>
      </footer>
    </article>
  );
}

/* ── feed ──────────────────────────────────────────────────── */

type DailyPlanFeedProps = Readonly<{ records: DailyAnalysis[] }>;

export function DailyPlanFeed({ records }: DailyPlanFeedProps) {
  return (
    <main className="dashboard-shell daily-plan-shell">
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
