import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Decimal } from '@prisma/client/runtime/library';

import {
  DCA_CONFIG_REPOSITORY,
  COIN_TRANSACTION_REPOSITORY,
  HOLDING_REPOSITORY
} from '../database/database.providers';
import { PortfolioService } from '../portfolio/portfolio.service';
import type { CreateDcaConfigDto } from './dto/create-dca-config.dto';
import type { UpdateDcaConfigDto } from './dto/update-dca-config.dto';

type DcaConfigRepository = ReturnType<typeof import('@app/db').createDcaConfigRepository>;
type CoinTransactionRepository = ReturnType<typeof import('@app/db').createCoinTransactionRepository>;
type HoldingRepository = ReturnType<typeof import('@app/db').createHoldingRepository>;

export type CapitalState = {
  totalBudget: number;
  deployedAmount: number;
  remaining: number;
  runnerAmount: number;
  runnerAvgCost: number;
};

@Injectable()
export class DcaService {
  constructor(
    @Inject(DCA_CONFIG_REPOSITORY)
    private readonly dcaConfigRepository: DcaConfigRepository,
    @Inject(COIN_TRANSACTION_REPOSITORY)
    private readonly txRepository: CoinTransactionRepository,
    @Inject(HOLDING_REPOSITORY)
    private readonly holdingRepository: HoldingRepository,
    private readonly portfolioService: PortfolioService
  ) {}

  listConfigs(userId: string) {
    return this.dcaConfigRepository.listByUserId(userId);
  }

  async getConfig(id: string, userId: string) {
    const config = await this.dcaConfigRepository.findById(id);

    if (!config) {
      throw new NotFoundException(`DCA config ${id} not found`);
    }

    if (config.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return config;
  }

  async createConfig(userId: string, input: CreateDcaConfigDto) {
    if (input.portfolioName && input.portfolioId) {
      throw new BadRequestException('Provide either portfolioId or portfolioName, not both');
    }

    let portfolioId: string;

    if (input.portfolioName) {
      const portfolio = await this.portfolioService.createPortfolio(userId, {
        name: input.portfolioName
      });
      portfolioId = portfolio.id;
    } else if (input.portfolioId) {
      await this.portfolioService.getPortfolio(input.portfolioId, userId);
      portfolioId = input.portfolioId;
    } else {
      throw new BadRequestException('Either portfolioId or portfolioName is required');
    }

    return this.dcaConfigRepository.create({
      id: randomUUID(),
      userId,
      coin: input.coin,
      totalBudget: new Decimal(input.totalBudget),
      portfolioId
    });
  }

  async updateConfig(id: string, userId: string, input: UpdateDcaConfigDto) {
    const config = await this.getConfig(id, userId);

    if (input.portfolioId) {
      await this.portfolioService.getPortfolio(input.portfolioId, userId);
    }

    if (input.totalBudget !== undefined) {
      const effectivePortfolioId = input.portfolioId ?? config.portfolioId;
      const capital = await this.getCapitalState({
        ...config,
        portfolioId: effectivePortfolioId
      });
      if (input.totalBudget < capital.deployedAmount) {
        throw new BadRequestException(
          `Cannot reduce budget below deployed amount ($${capital.deployedAmount.toFixed(2)})`
        );
      }
    }

    return this.dcaConfigRepository.update(id, {
      ...(input.totalBudget !== undefined ? { totalBudget: new Decimal(input.totalBudget) } : {}),
      ...(input.portfolioId ? { portfolioId: input.portfolioId } : {})
    });
  }

  async getCapitalState(config: { portfolioId: string; coin: string; totalBudget: Decimal }): Promise<CapitalState> {
    const transactions = await this.txRepository.listByPortfolio(config.portfolioId, {
      coinId: config.coin
    });

    let buyTotal = 0;
    for (const tx of transactions) {
      if (tx.type === 'buy') {
        buyTotal += Number(tx.totalValue);
      }
    }

    const totalBudget = Number(config.totalBudget);
    const deployedAmount = buyTotal;
    const remaining = totalBudget - deployedAmount;

    const holding = await this.holdingRepository.findByPortfolioAndCoin(config.portfolioId, config.coin);
    const runnerAmount = holding ? Number(holding.totalAmount) : 0;
    const runnerAvgCost = holding ? Number(holding.avgCost) : 0;

    return { totalBudget, deployedAmount, remaining, runnerAmount, runnerAvgCost };
  }
}
