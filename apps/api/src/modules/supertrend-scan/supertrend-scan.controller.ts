import { Controller, Inject, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { SupertrendH4ScanService } from './supertrend-h4-scan.service';
import { SupertrendScanService } from './supertrend-scan.service';

@ApiTags('Supertrend Scan')
@ApiCookieAuth('market_analysis_session')
@Controller('supertrend-scan')
export class SupertrendScanController {
  constructor(
    @Inject(SupertrendScanService)
    private readonly supertrendScanService: SupertrendScanService,
    @Inject(SupertrendH4ScanService)
    private readonly supertrendH4ScanService: SupertrendH4ScanService
  ) {}

  @Post('run')
  @ApiOperation({
    summary: 'Scan every Binance USDT spot pair for a bullish D1 Supertrend(10,3) and send the list to Telegram',
  })
  run() {
    return this.supertrendScanService.scan('manual');
  }

  @Post('run-h4')
  @ApiOperation({
    summary:
      'Scan every Binance USDT spot pair for a bullish 4H Supertrend(10,3) + bullish QQE and send the list to Telegram',
  })
  runH4() {
    return this.supertrendH4ScanService.scan('manual');
  }
}
