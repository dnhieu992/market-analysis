import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedRequest } from '../auth/auth.types';
import { CompoundPortfolioService } from '../compound-portfolio/compound-portfolio.service';
import { CompoundTransactionService } from './compound-transaction.service';
import { CreateCompoundTransactionDto } from './dto/create-compound-transaction.dto';
import { QueryCompoundTransactionsDto } from './dto/query-compound-transactions.dto';

@ApiTags('Compound Interest')
@ApiCookieAuth('market_analysis_session')
@Controller('compound-portfolios/:portfolioId/transactions')
export class CompoundTransactionController {
  constructor(
    @Inject(CompoundTransactionService)
    private readonly transactionService: CompoundTransactionService,
    @Inject(CompoundPortfolioService)
    private readonly portfolioService: CompoundPortfolioService
  ) {}

  @Get()
  @ApiOperation({ summary: 'List transactions for a compound portfolio' })
  async listTransactions(
    @Param('portfolioId') portfolioId: string,
    @Req() req: AuthenticatedRequest,
    @Query() query: QueryCompoundTransactionsDto
  ) {
    await this.portfolioService.getPortfolio(portfolioId, req.authUser!.id);
    return this.transactionService.listTransactions(portfolioId, query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a buy or sell transaction in a compound portfolio' })
  async createTransaction(
    @Param('portfolioId') portfolioId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateCompoundTransactionDto
  ) {
    await this.portfolioService.getPortfolio(portfolioId, req.authUser!.id);
    return this.transactionService.createTransaction(portfolioId, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete a compound transaction and recalculate holdings' })
  async removeTransaction(
    @Param('portfolioId') portfolioId: string,
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest
  ) {
    await this.portfolioService.getPortfolio(portfolioId, req.authUser!.id);
    return this.transactionService.removeTransaction(id, portfolioId);
  }
}
