import { Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedRequest } from '../auth/auth.types';
import { CompoundPortfolioService } from '../compound-portfolio/compound-portfolio.service';
import { CompoundHoldingsService } from './compound-holdings.service';

@ApiTags('Compound Interest')
@ApiCookieAuth('market_analysis_session')
@Controller('compound-portfolios/:portfolioId/holdings')
export class CompoundHoldingsController {
  constructor(
    @Inject(CompoundHoldingsService)
    private readonly holdingsService: CompoundHoldingsService,
    @Inject(CompoundPortfolioService)
    private readonly portfolioService: CompoundPortfolioService
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get holdings for a compound portfolio with optional unrealized PnL' })
  @ApiQuery({ name: 'prices', required: false, description: 'JSON map of current prices' })
  async getHoldings(
    @Param('portfolioId') portfolioId: string,
    @Req() req: AuthenticatedRequest,
    @Query('prices') pricesJson?: string
  ) {
    await this.portfolioService.getPortfolio(portfolioId, req.authUser!.id);
    const currentPrices: Record<string, number> = pricesJson ? JSON.parse(pricesJson) : {};
    return this.holdingsService.getByPortfolio(portfolioId, currentPrices);
  }

  @Post('recalculate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recalculate holdings from transaction history' })
  async recalculate(@Param('portfolioId') portfolioId: string, @Req() req: AuthenticatedRequest) {
    await this.portfolioService.getPortfolio(portfolioId, req.authUser!.id);
    await this.holdingsService.recalculate(portfolioId);
    return { message: 'Holdings recalculated successfully' };
  }
}
