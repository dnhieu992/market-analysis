import { Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../auth/public.decorator';
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

  @Post(':id/chart')
  @Public() // called by the local scalp-monitor cron (no session); renders public Binance data
  @ApiOperation({
    summary:
      "Render the 15m entry-moment chart for a scalp trade, upload it to R2, and attach the URL — called right after the position is opened, never on the entry path",
  })
  renderEntryChart(@Param('id') id: string) {
    return this.service.renderAndAttachEntryChart(id);
  }
}
