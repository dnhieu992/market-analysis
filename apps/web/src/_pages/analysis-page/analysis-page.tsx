import { createApiClient } from '@web/shared/api/client';
import type { DashboardAnalysisRun, DashboardSignal } from '@web/shared/api/types';
import { formatDateTime } from '@web/shared/lib/format';
import { AnalysisFeed } from '@web/widgets/analysis-feed/analysis-feed';

type AnalysisPageProps = Readonly<{
  searchParams?: {
    signal?: string | string[];
  };
}>;

async function loadAnalysisData() {
  const client = createApiClient();

  try {
    const [signals, analysisRuns] = await Promise.all([
      client.fetchSignals(),
      client.fetchAnalysisRuns()
    ]);

    return { signals, analysisRuns };
  } catch {
    return {
      signals: [] as DashboardSignal[],
      analysisRuns: [] as DashboardAnalysisRun[]
    };
  }
}

function pickSearchParam(searchParam?: string | string[]) {
  return Array.isArray(searchParam) ? searchParam[0] : searchParam;
}

function buildAnalysisRunLookup(
  analysisRuns: DashboardAnalysisRun[]
): Record<string, DashboardAnalysisRun> {
  return Object.fromEntries(analysisRuns.map((run) => [run.id, run]));
}

export default async function AnalysisPage({ searchParams }: AnalysisPageProps) {
  const { signals, analysisRuns } = await loadAnalysisData();
  const analysisRunLookup = buildAnalysisRunLookup(analysisRuns);
  const selectedSignalId = pickSearchParam(searchParams?.signal) ?? signals[0]?.id;
  const selectedSignal = signals.find((signal) => signal.id === selectedSignalId) ?? signals[0] ?? null;
  const selectedRun = selectedSignal ? analysisRunLookup[selectedSignal.analysisRunId] ?? null : null;
  const latestClose =
    analysisRuns[0]?.candleCloseTime instanceof Date
      ? formatDateTime(analysisRuns[0].candleCloseTime)
      : 'just now';

  return (
    <AnalysisFeed
      signals={signals}
      analysisRunLookup={analysisRunLookup}
      selectedSignal={selectedSignal}
      selectedRun={selectedRun}
      latestCloseLabel={latestClose}
    />
  );
}
