import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { STRATEGY_HISTORY_REPOSITORY, STRATEGY_REPOSITORY } from '../database/database.providers';
import type { CreateStrategyDto } from './dto/create-strategy.dto';
import type { CreateStrategyHistoryDto } from './dto/create-strategy-history.dto';
import type { UpdateStrategyDto } from './dto/update-strategy.dto';

type StrategyRepository = {
  create: (data: Record<string, unknown>) => Promise<unknown>;
  findById: (id: string) => Promise<unknown | null>;
  listAll: () => Promise<unknown[]>;
  update: (id: string, data: Record<string, unknown>) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
};

type StrategyHistoryRepository = {
  create: (data: Record<string, unknown>) => Promise<unknown>;
  listByStrategy: (strategyId: string) => Promise<unknown[]>;
  findById: (id: string) => Promise<unknown | null>;
  remove: (id: string) => Promise<unknown>;
};

@Injectable()
export class StrategiesService {
  constructor(
    @Inject(STRATEGY_REPOSITORY)
    private readonly strategyRepository: StrategyRepository,
    @Inject(STRATEGY_HISTORY_REPOSITORY)
    private readonly historyRepository: StrategyHistoryRepository
  ) {}

  listHistory(strategyId: string) {
    return this.historyRepository.listByStrategy(strategyId);
  }

  async addHistory(strategyId: string, input: CreateStrategyHistoryDto) {
    await this.getStrategyById(strategyId);
    return this.historyRepository.create({ ...input, strategyId });
  }

  async removeHistory(historyId: string) {
    const entry = await this.historyRepository.findById(historyId);
    if (!entry) {
      throw new NotFoundException(`Strategy history ${historyId} not found`);
    }
    return this.historyRepository.remove(historyId);
  }

  listStrategies() {
    return this.strategyRepository.listAll();
  }

  async getStrategyById(id: string) {
    const strategy = await this.strategyRepository.findById(id);

    if (!strategy) {
      throw new NotFoundException(`Strategy ${id} not found`);
    }

    return strategy;
  }

  createStrategy(input: CreateStrategyDto) {
    return this.strategyRepository.create({
      ...input,
      imageReference: input.imageReference ?? []
    });
  }

  updateStrategy(id: string, input: UpdateStrategyDto) {
    return this.strategyRepository.update(id, { ...input });
  }

  async removeStrategy(id: string) {
    await this.getStrategyById(id);
    return this.strategyRepository.remove(id);
  }
}
