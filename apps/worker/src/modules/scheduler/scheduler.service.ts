import { Injectable, Logger, Optional } from '@nestjs/common';

import { AnalysisOrchestratorService } from '../analysis/analysis-orchestrator.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly trackedSymbols: string[];

  constructor(
    private readonly analysisOrchestratorService: AnalysisOrchestratorService,
    @Optional() config?: { trackedSymbols: string[] }
  ) {
    this.trackedSymbols =
      config?.trackedSymbols ??
      (process.env.TRACKED_SYMBOLS ?? 'BTCUSDT')
        .split(',')
        .map((symbol) => symbol.trim())
        .filter(Boolean);
  }

  register() {
    this.logger.log('Worker scheduler registered');
  }

  runOnce(symbols = this.trackedSymbols) {
    return this.analysisOrchestratorService.runBatch(symbols);
  }
}
