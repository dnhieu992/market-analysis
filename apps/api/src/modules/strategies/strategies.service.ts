import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { STRATEGY_REPOSITORY } from '../database/database.providers';
import type { CreateStrategyDto } from './dto/create-strategy.dto';
import type { UpdateStrategyDto } from './dto/update-strategy.dto';

type StrategyRepository = {
  create: (data: Record<string, unknown>) => Promise<unknown>;
  findById: (id: string) => Promise<unknown | null>;
  listAll: () => Promise<unknown[]>;
  update: (id: string, data: Record<string, unknown>) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
};

@Injectable()
export class StrategiesService {
  constructor(
    @Inject(STRATEGY_REPOSITORY)
    private readonly strategyRepository: StrategyRepository
  ) {}

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
