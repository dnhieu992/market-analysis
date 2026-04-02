import { formatDateTime, formatPrice } from '../../lib/format';
import type { DashboardAnalysisRun, DashboardSignal } from '../../lib/types';
import { ConfidenceBadge } from './confidence-badge';

type AnalysisDetailPanelProps = Readonly<{
  signal?: DashboardSignal | null;
  analysisRun?: DashboardAnalysisRun | null;
}>;

function formatLevels(levels: number[]) {
  return levels.map((level) => formatPrice(level)).join(', ');
}

export function AnalysisDetailPanel({ signal, analysisRun }: AnalysisDetailPanelProps) {
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
          {analysisRun ? (
            <dl>
              <div>
                <dt>Run status</dt>
                <dd>{analysisRun.status}</dd>
              </div>
              <div>
                <dt>Candle open</dt>
                <dd>{formatDateTime(analysisRun.candleOpenTime)}</dd>
              </div>
              <div>
                <dt>Candle close</dt>
                <dd>{formatDateTime(analysisRun.candleCloseTime)}</dd>
              </div>
              <div>
                <dt>Price open</dt>
                <dd>{formatPrice(analysisRun.priceOpen)}</dd>
              </div>
              <div>
                <dt>Price high</dt>
                <dd>{formatPrice(analysisRun.priceHigh)}</dd>
              </div>
              <div>
                <dt>Price low</dt>
                <dd>{formatPrice(analysisRun.priceLow)}</dd>
              </div>
              <div>
                <dt>Price close</dt>
                <dd>{formatPrice(analysisRun.priceClose)}</dd>
              </div>
            </dl>
          ) : (
            <p>No analysis run was found for this signal.</p>
          )}
        </section>
      </div>
    </article>
  );
}
