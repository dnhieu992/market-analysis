import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';

import { COMPOUND_PORTFOLIO_REPOSITORY } from '../database/database.providers';
import type { CreateCompoundPortfolioDto } from './dto/create-compound-portfolio.dto';
import type { UpdateCompoundPortfolioDto } from './dto/update-compound-portfolio.dto';

type CompoundPortfolioRepository = ReturnType<typeof import('@app/db').createCompoundPortfolioRepository>;

@Injectable()
export class CompoundPortfolioService {
  constructor(
    @Inject(COMPOUND_PORTFOLIO_REPOSITORY)
    private readonly repository: CompoundPortfolioRepository
  ) {}

  listPortfolios(userId: string) {
    return this.repository.listByUserId(userId);
  }

  async getPortfolio(id: string, userId: string) {
    const portfolio = await this.repository.findById(id);

    if (!portfolio) {
      throw new NotFoundException(`Compound portfolio ${id} not found`);
    }

    if (portfolio.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return portfolio;
  }

  createPortfolio(userId: string, input: CreateCompoundPortfolioDto) {
    return this.repository.create({
      id: randomUUID(),
      userId,
      name: input.name,
      description: input.description
    });
  }

  async updatePortfolio(id: string, userId: string, input: UpdateCompoundPortfolioDto) {
    await this.getPortfolio(id, userId);
    return this.repository.update(id, input);
  }

  async removePortfolio(id: string, userId: string) {
    await this.getPortfolio(id, userId);
    return this.repository.remove(id);
  }
}
