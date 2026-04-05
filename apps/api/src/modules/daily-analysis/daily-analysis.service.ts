import { Inject, Injectable } from '@nestjs/common';
import { createDailyAnalysisRepository } from '@app/db';

import { DAILY_ANALYSIS_REPOSITORY } from '../database/database.providers';

type DailyAnalysisRepository = ReturnType<typeof createDailyAnalysisRepository>;

@Injectable()
export class DailyAnalysisService {
  constructor(
    @Inject(DAILY_ANALYSIS_REPOSITORY)
    private readonly dailyAnalysisRepository: DailyAnalysisRepository
  ) {}

  list(symbol?: string) {
    return this.dailyAnalysisRepository.listLatest(symbol ?? 'BTCUSDT', 30);
  }

  getLatest(symbol: string) {
    return this.dailyAnalysisRepository.listLatest(symbol, 1).then((rows) => rows[0] ?? null);
  }
}
