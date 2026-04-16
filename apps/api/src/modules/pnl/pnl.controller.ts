import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedRequest } from '../auth/auth.types';
import { PortfolioService } from '../portfolio/portfolio.service';
import { PnlService } from './pnl.service';
import { QueryPnlDto } from './dto/query-pnl.dto';

@ApiTags('PnL History')
@ApiCookieAuth('market_analysis_session')
@Controller('portfolios/:portfolioId/pnl')
export class PnlController {
  constructor(
    @Inject(PnlService)
    private readonly pnlService: PnlService,
    @Inject(PortfolioService)
    private readonly portfolioService: PortfolioService
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get PnL history for a portfolio (optionally filtered by coin or date range)' })
  async getPnlHistory(
    @Param('portfolioId') portfolioId: string,
    @Req() req: AuthenticatedRequest,
    @Query() query: QueryPnlDto
  ) {
    await this.portfolioService.getPortfolio(portfolioId, req.authUser!.id);
    return this.pnlService.getPnlHistory(portfolioId, query);
  }
}
