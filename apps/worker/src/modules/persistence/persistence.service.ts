import { Injectable, Optional } from '@nestjs/common';
import {
  createAnalysisRunRepository,
  createSignalRepository
} from '@app/db';
import type { LlmSignal } from '@app/core';

type AnalysisRunRepository = ReturnType<typeof createAnalysisRunRepository>;
type SignalRepository = ReturnType<typeof createSignalRepository>;

type StartRunInput = {
  symbol: string;
  timeframe: string;
  candleOpenTime: Date;
  candleCloseTime: Date;
  priceOpen: number;
  priceHigh: number;
  priceLow: number;
  priceClose: number;
  rawIndicatorsJson: string;
  llmInputJson: string;
};

type AnalysisRunRecord = {
  id: string;
  symbol: string;
  timeframe: string;
  candleOpenTime: Date;
  candleCloseTime: Date;
  priceOpen: number;
  priceHigh: number;
  priceLow: number;
  priceClose: number;
  rawIndicatorsJson: string;
  llmInputJson: string;
  llmOutputJson: string;
  status: string;
  errorMessage?: string | null;
};

type SignalRecord = {
  id: string;
  analysisRunId: string;
  symbol: string;
  timeframe: string;
  trend: string;
  bias: string;
  confidence: number;
  summary: string;
  supportLevelsJson: string;
  resistanceLevelsJson: string;
  invalidation: string;
  bullishScenario: string;
  bearishScenario: string;
};

@Injectable()
export class PersistenceService {
  constructor(
    @Optional()
    private readonly analysisRunRepository: AnalysisRunRepository = createAnalysisRunRepository(),
    @Optional()
    private readonly signalRepository: SignalRepository = createSignalRepository()
  ) {}

  async findExistingRun(
    symbol: string,
    timeframe: string,
    candleCloseTime: Date
  ): Promise<AnalysisRunRecord | null> {
    return (await this.analysisRunRepository.findByCandle(
      symbol,
      timeframe,
      candleCloseTime
    )) as AnalysisRunRecord | null;
  }

  async startRun(input: StartRunInput): Promise<AnalysisRunRecord> {
    return (await this.analysisRunRepository.create({
      ...input,
      llmOutputJson: '',
      status: 'pending'
    })) as AnalysisRunRecord;
  }

  async completeRun(
    runId: string,
    symbol: string,
    timeframe: string,
    signal: LlmSignal
  ): Promise<SignalRecord> {
    const createdSignal = (await this.signalRepository.create({
      analysisRunId: runId,
      symbol,
      timeframe,
      trend: signal.trend,
      bias: signal.bias,
      confidence: signal.confidence,
      summary: signal.summary,
      supportLevelsJson: JSON.stringify(signal.supportLevels),
      resistanceLevelsJson: JSON.stringify(signal.resistanceLevels),
      invalidation: signal.invalidation,
      bullishScenario: signal.bullishScenario,
      bearishScenario: signal.bearishScenario
    })) as SignalRecord;

    await this.analysisRunRepository.update(runId, {
      llmOutputJson: JSON.stringify(signal),
      status: 'completed'
    });

    return createdSignal;
  }

  async failRun(runId: string, errorMessage: string): Promise<AnalysisRunRecord> {
    return (await this.analysisRunRepository.update(runId, {
      status: 'failed',
      errorMessage
    })) as AnalysisRunRecord;
  }
}
