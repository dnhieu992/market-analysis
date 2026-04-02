import { formatPrice } from '@web/shared/lib/format';
import type { DashboardAnalysisRun, DashboardSignal } from '@web/shared/api/types';

import { ConfidenceBadge } from './confidence-badge';
import { AnalysisRunDetails } from '@web/entities/analysis-run/analysis-run-details';

type AnalysisSignalDetailPanelProps = Readonly<{
  signal?: DashboardSignal | null;
  analysisRun?: DashboardAnalysisRun | null;
}>;

function formatLevels(levels: number[]) {
  return levels.map((level) => formatPrice(level)).join(', ');
}

export function AnalysisSignalDetailPanel({
  signal,
  analysisRun
}: AnalysisSignalDetailPanelProps) {
  if (!signal) {
    return (
      <article className="panel analysis-detail-panel">
        <h2>Selected Analysis</h2>
        <p>Select a signal card to inspect structured worker output.</p>
      </article>
    );
  }

  return (
    <article className="panel analysis-detail-panel">
      <div className="analysis-detail-head">
        <div>
          <p className="analysis-card-symbol">{signal.symbol}</p>
          <p className="analysis-card-timeframe">{signal.timeframe}</p>
        </div>
        <ConfidenceBadge confidence={signal.confidence} />
      </div>

      <h2>Selected Analysis</h2>
      <p>{signal.summary}</p>

      <div className="analysis-detail-grid">
        <section className="analysis-detail-section">
          <h3>Signal View</h3>
          <dl>
            <div>
              <dt>Trend</dt>
              <dd>{signal.trend}</dd>
            </div>
            <div>
              <dt>Bias</dt>
              <dd>{signal.bias}</dd>
            </div>
            <div>
              <dt>Confidence</dt>
              <dd>{signal.confidence}%</dd>
            </div>
            <div>
              <dt>Support</dt>
              <dd>{formatLevels(signal.supportLevels)}</dd>
            </div>
            <div>
              <dt>Resistance</dt>
              <dd>{formatLevels(signal.resistanceLevels)}</dd>
            </div>
            <div>
              <dt>Invalidation</dt>
              <dd>{signal.invalidation}</dd>
            </div>
          </dl>
        </section>

        <section className="analysis-detail-section">
          <h3>Run View</h3>
          <AnalysisRunDetails analysisRun={analysisRun} />
        </section>
      </div>
    </article>
  );
}
