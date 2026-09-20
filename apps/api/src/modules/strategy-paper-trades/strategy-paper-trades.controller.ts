import { Body, Controller, Get, Inject, Param, Post, Put } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../auth/public.decorator';
import { StrategyPaperTradesService } from './strategy-paper-trades.service';

@ApiTags('Strategy Paper Trades')
@ApiCookieAuth('market_analysis_session')
@Controller('strategy-paper-trades')
export class StrategyPaperTradesController {
  constructor(
    @Inject(StrategyPaperTradesService)
    private readonly service: StrategyPaperTradesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'PDH/PDL breakout paper-trade board: open trades, closed history, stats, and the strategy doc.' })
  getBoard() {
    return this.service.getBoard();
  }

  @Post('scan')
  @Public() // safe to trigger manually; pure simulation over public Binance data, no exchange
  @ApiOperation({ summary: 'Run one engine tick now (manage open trades + look for a new PDH/PDL breakout).' })
  scan() {
    return this.service.runScanTick();
  }

  @Post(':id/chart')
  @Public() // renders public Binance data; safe to (re)trigger for backfill
  @ApiOperation({ summary: 'Render the 1h setup chart for a trade, upload to R2, and attach the URL.' })
  renderChart(@Param('id') id: string) {
    return this.service.renderAndAttachEntryChart(id);
  }

  @Put(':id/feedback')
  @ApiOperation({ summary: 'Attach the traderʼs review (1..5 rating + note) to a trade.' })
  saveFeedback(@Param('id') id: string, @Body() body: { rating?: number | null; note?: string | null }) {
    return this.service.saveFeedback(id, body?.rating ?? null, body?.note ?? null);
  }

  @Get('doc')
  @ApiOperation({ summary: 'The editable strategy description + params.' })
  getDoc() {
    return this.service.getDoc();
  }

  @Put('doc')
  @ApiOperation({ summary: 'Update the editable strategy description / params.' })
  updateDoc(@Body() body: { docMarkdown?: string; name?: string; enabled?: boolean; riskUsd?: number; rrPlanned?: number }) {
    return this.service.updateDoc(body ?? {});
  }

  @Post('doc/reset')
  @ApiOperation({ summary: 'Reset the strategy description back to the built-in default.' })
  resetDoc() {
    return this.service.resetDoc();
  }
}
