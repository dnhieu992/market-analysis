import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedRequest } from '../auth/auth.types';
import { PortfolioService } from '../portfolio/portfolio.service';
import { TransactionService } from './transaction.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { QueryTransactionsDto } from './dto/query-transactions.dto';

@ApiTags('Transactions')
@ApiCookieAuth('market_analysis_session')
@Controller('portfolios/:portfolioId/transactions')
export class TransactionController {
  constructor(
    @Inject(TransactionService)
    private readonly transactionService: TransactionService,
    @Inject(PortfolioService)
    private readonly portfolioService: PortfolioService
  ) {}

  @Get()
  @ApiOperation({ summary: 'List transactions for a portfolio' })
  async listTransactions(
    @Param('portfolioId') portfolioId: string,
    @Req() req: AuthenticatedRequest,
    @Query() query: QueryTransactionsDto
  ) {
    await this.portfolioService.getPortfolio(portfolioId, req.authUser!.id);
    return this.transactionService.listTransactions(portfolioId, query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a buy or sell transaction' })
  async createTransaction(
    @Param('portfolioId') portfolioId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateTransactionDto
  ) {
    await this.portfolioService.getPortfolio(portfolioId, req.authUser!.id);
    return this.transactionService.createTransaction(portfolioId, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete a transaction and recalculate holdings' })
  async removeTransaction(
    @Param('portfolioId') portfolioId: string,
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest
  ) {
    await this.portfolioService.getPortfolio(portfolioId, req.authUser!.id);
    return this.transactionService.removeTransaction(id, portfolioId);
  }
}
