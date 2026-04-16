import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';

import { PORTFOLIO_REPOSITORY } from '../database/database.providers';
import type { CreatePortfolioDto } from './dto/create-portfolio.dto';
import type { UpdatePortfolioDto } from './dto/update-portfolio.dto';

type PortfolioRepository = ReturnType<typeof import('@app/db').createPortfolioRepository>;

@Injectable()
export class PortfolioService {
  constructor(
    @Inject(PORTFOLIO_REPOSITORY)
    private readonly portfolioRepository: PortfolioRepository
  ) {}

  listPortfolios(userId: string) {
    return this.portfolioRepository.listByUserId(userId);
  }

  async getPortfolio(id: string, userId: string) {
    const portfolio = await this.portfolioRepository.findById(id);

    if (!portfolio) {
      throw new NotFoundException(`Portfolio ${id} not found`);
    }

    if (portfolio.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return portfolio;
  }

  createPortfolio(userId: string, input: CreatePortfolioDto) {
    return this.portfolioRepository.create({
      id: randomUUID(),
      userId,
      name: input.name,
      description: input.description
    });
  }

  async updatePortfolio(id: string, userId: string, input: UpdatePortfolioDto) {
    await this.getPortfolio(id, userId);
    return this.portfolioRepository.update(id, input);
  }

  async removePortfolio(id: string, userId: string) {
    await this.getPortfolio(id, userId);
    return this.portfolioRepository.remove(id);
  }
}
