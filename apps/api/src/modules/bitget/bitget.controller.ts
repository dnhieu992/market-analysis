import { Controller, Get, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { BitgetService } from './bitget.service';

@ApiTags('bitget')
@ApiCookieAuth('market_analysis_session')
@Controller('bitget')
export class BitgetController {
  constructor(private readonly service: BitgetService) {}

  @Get('positions')
  @ApiOperation({ summary: 'List all open positions on Bitget USDT futures' })
  getPositions() {
    return this.service.getOpenPositions();
  }

  @Get('history')
  @ApiOperation({ summary: 'Closed-trade history + realized PnL summary (from DB)' })
  getHistory(@Query('limit') limit?: string, @Query('symbol') symbol?: string) {
    const parsed = Number(limit);
    const take = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 500) : 200;
    return this.service.getClosedHistory(take, symbol?.trim() || undefined);
  }
}
