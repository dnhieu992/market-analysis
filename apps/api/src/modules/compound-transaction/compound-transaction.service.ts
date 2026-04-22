import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Decimal } from '@prisma/client/runtime/library';

import { prisma } from '@app/db';
import { COMPOUND_HOLDING_REPOSITORY, COMPOUND_TRANSACTION_REPOSITORY } from '../database/database.providers';
import { CompoundHoldingsService } from '../compound-holdings/compound-holdings.service';
import type { CreateCompoundTransactionDto } from './dto/create-compound-transaction.dto';
import type { QueryCompoundTransactionsDto } from './dto/query-compound-transactions.dto';

type CompoundTransactionRepository = ReturnType<typeof import('@app/db').createCompoundTransactionRepository>;
type CompoundHoldingRepository = ReturnType<typeof import('@app/db').createCompoundHoldingRepository>;

@Injectable()
export class CompoundTransactionService {
  constructor(
    @Inject(COMPOUND_TRANSACTION_REPOSITORY)
    private readonly txRepository: CompoundTransactionRepository,
    @Inject(COMPOUND_HOLDING_REPOSITORY)
    private readonly holdingRepository: CompoundHoldingRepository,
    private readonly holdingsService: CompoundHoldingsService
  ) {}

  listTransactions(compoundPortfolioId: string, query: QueryCompoundTransactionsDto) {
    return this.txRepository.listByPortfolio(compoundPortfolioId, {
      coinId: query.coinId,
      type: query.type,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined
    });
  }

  async createTransaction(compoundPortfolioId: string, input: CreateCompoundTransactionDto) {
    const totalValue = input.price * input.amount;

    if (input.type === 'sell') {
      const holding = await this.holdingRepository.findByPortfolioAndCoin(compoundPortfolioId, input.coinId);
      const currentAmount = holding ? Number(holding.totalAmount) : 0;

      if (input.amount > currentAmount) {
        throw new BadRequestException(
          `Cannot sell ${input.amount} ${input.coinId} — only ${currentAmount} available in holdings`
        );
      }
    }

    return prisma.$transaction(async () => {
      const tx = await prisma.compoundTransaction.create({
        data: {
          id: randomUUID(),
          compoundPortfolioId,
          coinId: input.coinId,
          type: input.type,
          price: new Decimal(input.price),
          amount: new Decimal(input.amount),
          totalValue: new Decimal(totalValue),
          fee: new Decimal(input.fee ?? 0),
          note: input.note,
          transactedAt: input.transactedAt ? new Date(input.transactedAt) : new Date()
        }
      });

      if (input.type === 'buy') {
        await this.holdingsService.updateOnBuy(compoundPortfolioId, input.coinId, input.amount, totalValue);
      } else {
        await this.holdingsService.updateOnSell(compoundPortfolioId, input.coinId, input.amount, input.price);
      }

      return tx;
    });
  }

  async removeTransaction(id: string, compoundPortfolioId: string) {
    const tx = await this.txRepository.findById(id);

    if (
      !tx ||
      (tx as { compoundPortfolioId: string }).compoundPortfolioId !== compoundPortfolioId ||
      (tx as { deletedAt: Date | null }).deletedAt !== null
    ) {
      throw new NotFoundException(`Transaction ${id} not found`);
    }

    await this.txRepository.softDelete(id);
    await this.holdingsService.recalculate(compoundPortfolioId, (tx as { coinId: string }).coinId);

    return { message: 'Transaction deleted and holdings recalculated' };
  }
}
