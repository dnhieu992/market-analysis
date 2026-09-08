import { Controller, Inject, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { SupertrendScanService } from './supertrend-scan.service';

@ApiTags('Supertrend Scan')
@ApiCookieAuth('market_analysis_session')
@Controller('supertrend-scan')
export class SupertrendScanController {
  constructor(
    @Inject(SupertrendScanService)
    private readonly supertrendScanService: SupertrendScanService
  ) {}

  @Post('run')
  @ApiOperation({
    summary: 'Scan every Binance USDT spot pair for a bullish D1 Supertrend(10,3) and send the list to Telegram',
  })
  run() {
    return this.supertrendScanService.scan('manual');
  }
}
