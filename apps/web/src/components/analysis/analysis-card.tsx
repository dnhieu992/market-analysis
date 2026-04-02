import Link from 'next/link';

import { formatConfidence, formatDateTime, formatPrice } from '../../lib/format';
import type { DashboardAnalysisRun, DashboardSignal } from '../../lib/types';
import { ConfidenceBadge } from './confidence-badge';

type AnalysisCardProps = Readonly<{
  signal: DashboardSignal;
  analysisRun?: DashboardAnalysisRun | null;
  selected?: boolean;
}>;

function formatLevels(levels: number[]) {
  return levels.map((level) => formatPrice(level)).join(', ');
}

export function AnalysisCard({ signal, analysisRun, selected = false }: AnalysisCardProps) {
  const cardClass = selected ? 'analysis-card analysis-card-selected' : 'analysis-card';

  return (
    <article className={cardClass}>
      <div className="analysis-card-head">
        <div>
          <p className="analysis-card-symbol">{signal.symbol}</p>
          <p className="analysis-card-timeframe">{signal.timeframe}</p>
        </div>
        <ConfidenceBadge confidence={signal.confidence} />
      </div>

      <dl className="analysis-card-meta">
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
          <dd>{formatConfidence(signal.confidence)}</dd>
        </div>
        <div>
          <dt>Support</dt>
          <dd>{formatLevels(signal.supportLevels)}</dd>
        </div>
        <div>
          <dt>Resistance</dt>
          <dd>{formatLevels(signal.resistanceLevels)}</dd>
        </div>
      </dl>

      <p className="analysis-card-summary">{signal.summary}</p>

      <div className="analysis-card-run">
        <span>Signal confidence {formatConfidence(signal.confidence)}</span>
        <span>
          Run close{' '}
          {analysisRun ? formatDateTime(analysisRun.candleCloseTime) : formatDateTime(signal.createdAt)}
        </span>
      </div>

      <Link href={`/analysis?signal=${signal.id}`} className="analysis-link">
        View details
      </Link>
    </article>
  );
}
