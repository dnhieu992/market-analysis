import { Inject, Injectable } from '@nestjs/common';
import { createDailyAnalysisRepository } from '@app/db';

import { DAILY_ANALYSIS_REPOSITORY } from '../database/database.providers';

type DailyAnalysisRepository = ReturnType<typeof createDailyAnalysisRepository>;

export type DailyAnalysisRecord = {
  id: string;
  symbol: string;
  date: Date;
  d1Trend: string;
  h4Trend: string;
  d1S1: number;
  d1S2: number;
  d1R1: number;
  d1R2: number;
  h4S1: number;
  h4S2: number;
  h4R1: number;
  h4R2: number;
  summary: string;
  createdAt: Date;
};

@Injectable()
export class DailyAnalysisService {
  constructor(
    @Inject(DAILY_ANALYSIS_REPOSITORY)
    private readonly dailyAnalysisRepository: DailyAnalysisRepository
  ) {}

  list(symbol?: string): Promise<DailyAnalysisRecord[]> {
    return this.dailyAnalysisRepository.listLatest(symbol ?? 'BTCUSDT', 30);
  }

  getLatest(symbol: string): Promise<DailyAnalysisRecord | null> {
    return this.dailyAnalysisRepository.listLatest(symbol, 1).then((rows) => rows[0] ?? null);
  }
}
