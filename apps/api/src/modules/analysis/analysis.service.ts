import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { ANALYSIS_RUN_REPOSITORY } from '../database/database.providers';
import type { QueryAnalysisRunsDto } from './dto/query-analysis-runs.dto';

type AnalysisRunRepository = {
  findById: (id: string) => Promise<unknown | null>;
  listLatest: (limit?: number) => Promise<unknown[]>;
};

@Injectable()
export class AnalysisService {
  constructor(
    @Inject(ANALYSIS_RUN_REPOSITORY)
    private readonly analysisRunRepository: AnalysisRunRepository
  ) {}

  async listAnalysisRuns(query: QueryAnalysisRunsDto) {
    const rows = await this.analysisRunRepository.listLatest(50);

    return rows.filter((row) => {
      const candidate = row as { symbol?: string; timeframe?: string };
      return (
        (!query.symbol || candidate.symbol === query.symbol) &&
        (!query.timeframe || candidate.timeframe === query.timeframe)
      );
    });
  }

  async getAnalysisRunById(id: string) {
    const run = await this.analysisRunRepository.findById(id);

    if (!run) {
      throw new NotFoundException(`Analysis run ${id} not found`);
    }

    return run;
  }

  async getLatestAnalysisRun(symbol: string, timeframe: string) {
    const runs = await this.listAnalysisRuns({ symbol, timeframe });
    return runs[0] ?? null;
  }
}
