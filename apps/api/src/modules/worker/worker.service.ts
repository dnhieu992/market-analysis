import { ForbiddenException, Injectable, Optional } from '@nestjs/common';

import type { RunAnalysisDto } from './dto/run-analysis.dto';

type WorkerTriggerConfig = {
  enabled: boolean;
  trackedSymbols: string[];
};

type WorkerTriggerExecutor = (symbols: string[]) => Promise<{
  status: string;
  scheduled: string[];
}>;

@Injectable()
export class WorkerService {
  private readonly config: WorkerTriggerConfig;
  private readonly triggerAnalysisBatch: WorkerTriggerExecutor;

  constructor(
    @Optional() config?: WorkerTriggerConfig,
    @Optional() triggerAnalysisBatch?: WorkerTriggerExecutor
  ) {
    this.config = config ?? {
      enabled: process.env.MANUAL_ANALYSIS_TRIGGER_ENABLED === 'true',
      trackedSymbols: (process.env.TRACKED_SYMBOLS ?? 'BTCUSDT')
        .split(',')
        .map((symbol) => symbol.trim())
        .filter(Boolean)
    };
    this.triggerAnalysisBatch =
      triggerAnalysisBatch ??
      (async (symbols) => ({
        status: 'queued',
        scheduled: symbols
      }));
  }

  async runAnalysis(input: RunAnalysisDto) {
    if (!this.config.enabled) {
      throw new ForbiddenException('Manual analysis trigger is disabled');
    }

    const symbols = input.symbol ? [input.symbol] : this.config.trackedSymbols;

    return this.triggerAnalysisBatch(symbols);
  }
}
