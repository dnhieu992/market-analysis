import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedRequest } from '../auth/auth.types';
import { PortfolioService } from '../portfolio/portfolio.service';
import { TransferCoinDto } from './dto/transfer-coin.dto';
import { HoldingsService } from './holdings.service';

@ApiTags('Holdings')
@ApiCookieAuth('market_analysis_session')
@Controller('portfolios/:portfolioId/holdings')
export class HoldingsController {
  constructor(
    @Inject(HoldingsService)
    private readonly holdingsService: HoldingsService,
    @Inject(PortfolioService)
    private readonly portfolioService: PortfolioService
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get holdings for a portfolio with optional unrealized PnL' })
  @ApiQuery({
    name: 'prices',
    required: false,
    description: 'JSON map of current prices e.g. {"BTC":50000,"ETH":3000}'
  })
  async getHoldings(
    @Param('portfolioId') portfolioId: string,
    @Req() req: AuthenticatedRequest,
    @Query('prices') pricesJson?: string
  ) {
    await this.portfolioService.getPortfolio(portfolioId, req.authUser!.id);

    const currentPrices: Record<string, number> = pricesJson ? JSON.parse(pricesJson) : {};
    return this.holdingsService.getByPortfolio(portfolioId, currentPrices);
  }

  @Patch(':coinId/note')
  @ApiOperation({ summary: 'Update note for a holding' })
  async updateNote(
    @Param('portfolioId') portfolioId: string,
    @Param('coinId') coinId: string,
    @Body() body: { note: string | null },
    @Req() req: AuthenticatedRequest
  ) {
    await this.portfolioService.getPortfolio(portfolioId, req.authUser!.id);
    return this.holdingsService.updateNote(portfolioId, coinId, body.note ?? null);
  }

  @Post('recalculate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recalculate holdings from transaction history' })
  async recalculate(@Param('portfolioId') portfolioId: string, @Req() req: AuthenticatedRequest) {
    await this.portfolioService.getPortfolio(portfolioId, req.authUser!.id);
    await this.holdingsService.recalculate(portfolioId);
    return { message: 'Holdings recalculated successfully' };
  }

  @Post(':coinId/transfer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Move a coin position (all its transactions) to another portfolio' })
  async transfer(
    @Param('portfolioId') portfolioId: string,
    @Param('coinId') coinId: string,
    @Body() body: TransferCoinDto,
    @Req() req: AuthenticatedRequest
  ) {
    // Verify the caller owns BOTH the source and the destination portfolio.
    await this.portfolioService.getPortfolio(portfolioId, req.authUser!.id);
    await this.portfolioService.getPortfolio(body.targetPortfolioId, req.authUser!.id);
    return this.holdingsService.transferCoin(portfolioId, coinId, body.targetPortfolioId);
  }
}
