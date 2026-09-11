import { Controller, Get, Inject } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ScalpPaperTradesService } from './scalp-paper-trades.service';

@ApiTags('Scalp Paper Trades')
@ApiCookieAuth('market_analysis_session')
@Controller('scalp-paper-trades')
export class ScalpPaperTradesController {
  constructor(
    @Inject(ScalpPaperTradesService)
    private readonly service: ScalpPaperTradesService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'The open paper trade (if any) plus closed history and stats — read-only, written by scripts/run-scalp-paper-monitor.ts',
  })
  getBoard() {
    return this.service.getBoard();
  }
}
