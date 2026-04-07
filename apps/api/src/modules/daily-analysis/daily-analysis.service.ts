import { Inject, Injectable } from '@nestjs/common';
import type { DailyAnalysisPlan } from '@app/core';
import { createDailyAnalysisRepository } from '@app/db';

import { DAILY_ANALYSIS_REPOSITORY } from '../database/database.providers';

type DailyAnalysisRepository = ReturnType<typeof createDailyAnalysisRepository>;

export type DailyAnalysisRecord = {
  aiOutput: DailyAnalysisPlan;
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
  llmProvider: string;
  llmModel: string;
  aiOutputJson: string;
  summary: string;
  createdAt: Date;
};

@Injectable()
export class DailyAnalysisService {
  constructor(
    @Inject(DAILY_ANALYSIS_REPOSITORY)
    private readonly dailyAnalysisRepository: DailyAnalysisRepository
  ) {}

  async list(symbol?: string): Promise<DailyAnalysisRecord[]> {
    const rows = await this.dailyAnalysisRepository.listLatest(symbol ?? 'BTCUSDT', 30);
    return rows.map((row) => this.mapRecord(row as DailyAnalysisRecord));
  }

  async getLatest(symbol: string): Promise<DailyAnalysisRecord | null> {
    const rows = await this.dailyAnalysisRepository.listLatest(symbol, 1);
    const record = rows[0] as DailyAnalysisRecord | undefined;
    return record ? this.mapRecord(record) : null;
  }

  private mapRecord(record: DailyAnalysisRecord): DailyAnalysisRecord {
    return {
      ...record,
      aiOutput: JSON.parse(record.aiOutputJson) as DailyAnalysisPlan
    };
  }
}
