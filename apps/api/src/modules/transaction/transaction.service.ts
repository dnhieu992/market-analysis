import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Decimal } from '@prisma/client/runtime/library';

import { prisma } from '@app/db';
import { COIN_TRANSACTION_REPOSITORY, HOLDING_REPOSITORY } from '../database/database.providers';
import { HoldingsService } from '../holdings/holdings.service';
import type { CreateTransactionDto } from './dto/create-transaction.dto';
import type { QueryTransactionsDto } from './dto/query-transactions.dto';
import type { UpdateTransactionDto } from './dto/update-transaction.dto';

type CoinTransactionRepository = ReturnType<typeof import('@app/db').createCoinTransactionRepository>;
type HoldingRepository = ReturnType<typeof import('@app/db').createHoldingRepository>;

@Injectable()
export class TransactionService {
  constructor(
    @Inject(COIN_TRANSACTION_REPOSITORY)
    private readonly txRepository: CoinTransactionRepository,
    @Inject(HOLDING_REPOSITORY)
    private readonly holdingRepository: HoldingRepository,
    private readonly holdingsService: HoldingsService
  ) {}

  listTransactions(portfolioId: string, query: QueryTransactionsDto) {
    return this.txRepository.listByPortfolio(portfolioId, {
      coinId: query.coinId,
      type: query.type,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined
    });
  }

  async createTransaction(portfolioId: string, input: CreateTransactionDto) {
    const totalValue = input.price * input.amount;

    if (input.type === 'sell') {
      const holding = await this.holdingRepository.findByPortfolioAndCoin(portfolioId, input.coinId);
      const currentAmount = holding ? Number(holding.totalAmount) : 0;

      if (input.amount > currentAmount) {
        throw new BadRequestException(
          `Cannot sell ${input.amount} ${input.coinId} — only ${currentAmount} available in holdings`
        );
      }
    }

    return prisma.$transaction(async () => {
      const tx = await prisma.coinTransaction.create({
        data: {
          id: randomUUID(),
          portfolioId,
          coinId: input.coinId,
          type: input.type,
          price: new Decimal(input.price),
          amount: new Decimal(input.amount),
          totalValue: new Decimal(totalValue),
          fee: new Decimal(input.fee ?? 0),
          note: input.note,
          images: input.images ?? [],
          transactedAt: input.transactedAt ? new Date(input.transactedAt) : new Date()
        }
      });

      if (input.type === 'buy') {
        await this.holdingsService.updateOnBuy(portfolioId, input.coinId, input.amount, totalValue);
      } else {
        await this.holdingsService.updateOnSell(portfolioId, input.coinId, input.amount, input.price);
      }

      return tx;
    });
  }

  async updateTransaction(id: string, portfolioId: string, input: UpdateTransactionDto) {
    const tx = await this.txRepository.findById(id);
    if (!tx || (tx as { portfolioId: string }).portfolioId !== portfolioId || (tx as { deletedAt: Date | null }).deletedAt !== null) {
      throw new NotFoundException(`Transaction ${id} not found`);
    }

    await prisma.coinTransaction.update({
      where: { id },
      data: {
        ...(input.type !== undefined && { type: input.type }),
        ...(input.price !== undefined && { price: new Decimal(input.price) }),
        ...(input.amount !== undefined && { amount: new Decimal(input.amount) }),
        ...(input.amount !== undefined && input.price !== undefined && { totalValue: new Decimal(input.amount * input.price) }),
        ...(input.fee !== undefined && { fee: new Decimal(input.fee) }),
        ...(input.transactedAt !== undefined && { transactedAt: new Date(input.transactedAt) }),
        ...('note' in input && { note: input.note ?? null }),
        ...('images' in input && { images: input.images ?? [] }),
      }
    });

    await this.holdingsService.recalculate(portfolioId, (tx as { coinId: string }).coinId);
    return { message: 'Transaction updated and holdings recalculated' };
  }

  async removeTransaction(id: string, portfolioId: string) {
    const tx = await this.txRepository.findById(id);

    if (!tx || (tx as { portfolioId: string }).portfolioId !== portfolioId || (tx as { deletedAt: Date | null }).deletedAt !== null) {
      throw new NotFoundException(`Transaction ${id} not found`);
    }

    await this.txRepository.softDelete(id);
    await this.holdingsService.recalculate(portfolioId, (tx as { coinId: string }).coinId);

    return { message: 'Transaction deleted and holdings recalculated' };
  }
}
