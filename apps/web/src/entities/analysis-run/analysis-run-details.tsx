import { formatDateTime, formatPrice } from '@web/shared/lib/format';
import type { DashboardAnalysisRun } from '@web/shared/api/types';

type AnalysisRunDetailsProps = Readonly<{
  analysisRun?: DashboardAnalysisRun | null;
}>;

export function AnalysisRunDetails({ analysisRun }: AnalysisRunDetailsProps) {
  if (!analysisRun) {
    return <p>No analysis run was found for this signal.</p>;
  }

  return (
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
  );
}
