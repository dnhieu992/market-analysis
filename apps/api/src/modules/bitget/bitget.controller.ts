import { Controller, Get } from '@nestjs/common';
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
}
