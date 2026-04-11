import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AnalysisTimeframe } from '@app/config';

import { MarketDataService } from '../market/market-data.service';
import { BackTestEngineService } from './back-test-engine.service';
import { StrategyRegistryService } from './strategy-registry.service';
import { BACK_TEST_RESULT_REPOSITORY } from './back-test.providers';
import type { createBackTestResultRepository } from '@app/db';

type BackTestResultRepository = ReturnType<typeof createBackTestResultRepository>;

export type RunBackTestDto = {
  strategy: string;
  symbol: string;
  from: string;
  to: string;
  timeframe?: string;
};

@Injectable()
export class BackTestService {
  constructor(
    private readonly strategyRegistry: StrategyRegistryService,
    private readonly engine: BackTestEngineService,
    private readonly marketData: MarketDataService,
    @Inject(BACK_TEST_RESULT_REPOSITORY)
    private readonly repository: BackTestResultRepository
  ) {}

  listStrategies() {
    return this.strategyRegistry.listStrategies();
  }

  async runBackTest(dto: RunBackTestDto) {
    const strategy = this.strategyRegistry.getStrategy(dto.strategy);

    if (!strategy) {
      throw new NotFoundException(`Strategy '${dto.strategy}' not found`);
    }

    const timeframe = (dto.timeframe ?? strategy.defaultTimeframe) as AnalysisTimeframe;

    const candles = await this.marketData.getCandlesInRange(
      dto.symbol,
      timeframe,
      new Date(dto.from),
      new Date(dto.to)
    );

    if (candles.length < 2) {
      throw new BadRequestException('Insufficient candles for the requested date range');
    }

    const summary = this.engine.run(strategy, candles, dto.symbol);

    const record = await this.repository.create({
      strategy: dto.strategy,
      symbol: dto.symbol,
      timeframe,
      fromDate: new Date(dto.from),
      toDate: new Date(dto.to),
      totalTrades: summary.totalTrades,
      winRate: summary.winRate,
      totalPnl: summary.totalPnl,
      maxDrawdown: summary.maxDrawdown,
      sharpeRatio: summary.sharpeRatio ?? undefined,
      tradesJson: JSON.stringify(summary.trades),
      parametersJson: JSON.stringify({ strategy: dto.strategy, symbol: dto.symbol, timeframe, from: dto.from, to: dto.to }),
      status: 'completed'
    });

    return {
      id: record.id,
      strategy: dto.strategy,
      symbol: dto.symbol,
      timeframe,
      from: dto.from,
      to: dto.to,
      ...summary
    };
  }

  async listResults(strategy?: string, symbol?: string) {
    return strategy
      ? this.repository.listByStrategy(strategy, symbol)
      : this.repository.listLatest();
  }

  async getResult(id: string) {
    const record = await this.repository.findById(id);
    if (!record) throw new NotFoundException(`Back-test result '${id}' not found`);
    return record;
  }
}
