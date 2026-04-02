import Link from 'next/link';

import { formatConfidence, formatDateTime } from '../../lib/format';
import type { DashboardAnalysisRun, DashboardSignal } from '../../lib/types';

type RecentAnalysisPanelProps = Readonly<{
  signals: DashboardSignal[];
  analysisRuns: DashboardAnalysisRun[];
}>;

function getLatestRunForSignal(signal: DashboardSignal, analysisRuns: DashboardAnalysisRun[]) {
  return analysisRuns.find((run) => run.id === signal.analysisRunId);
}

export function RecentAnalysisPanel({ signals, analysisRuns }: RecentAnalysisPanelProps) {
  return (
    <article className="panel">
      <h2>Recent Analysis</h2>
      <p>Structured signal summaries from the worker.</p>

      <div className="analysis-list">
        {signals.slice(0, 3).map((signal) => {
          const run = getLatestRunForSignal(signal, analysisRuns);

          return (
            <div key={signal.id} className="analysis-item">
              <div className="analysis-item-head">
                <span className="analysis-symbol">{signal.symbol}</span>
                <span className={`analysis-badge analysis-badge-${signal.bias}`}>{signal.bias}</span>
              </div>
              <p className="analysis-summary">{signal.summary}</p>
              <dl className="analysis-meta">
                <div>
                  <dt>Trend</dt>
                  <dd>{signal.trend}</dd>
                </div>
                <div>
                  <dt>Confidence</dt>
                  <dd>{formatConfidence(signal.confidence)}</dd>
                </div>
                <div>
                  <dt>Signal time</dt>
                  <dd>{formatDateTime(signal.createdAt)}</dd>
                </div>
                {run ? (
                  <div>
                    <dt>Run close</dt>
                    <dd>{formatDateTime(run.candleCloseTime)}</dd>
                  </div>
                ) : null}
              </dl>
              <div className="analysis-levels">
                <span>Support: {signal.supportLevels.map((level) => level.toLocaleString()).join(', ')}</span>
                <span>
                  Resistance: {signal.resistanceLevels.map((level) => level.toLocaleString()).join(', ')}
                </span>
              </div>
              <Link href={`/analysis?signal=${signal.id}`} className="analysis-link">
                View analysis details
              </Link>
            </div>
          );
        })}
      </div>
    </article>
  );
}
