import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../auth/public.decorator';
import { RsiVolumePaperEngineService } from './rsi-volume-paper-engine.service';
import { StrategyPaperTradesService } from './strategy-paper-trades.service';

@ApiTags('Strategy Paper Trades')
@ApiCookieAuth('market_analysis_session')
@Controller('strategy-paper-trades')
export class StrategyPaperTradesController {
  constructor(
    @Inject(StrategyPaperTradesService)
    private readonly service: StrategyPaperTradesService,
    @Inject(RsiVolumePaperEngineService)
    private readonly rsiEngine: RsiVolumePaperEngineService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Multi-strategy paper-trade board: strategies (+ per-strategy stats), open trades, closed history.' })
  getBoard() {
    return this.service.getBoard();
  }

  @Post('scan')
  @Public() // safe to trigger manually; pure simulation over public Binance data, no exchange
  @ApiOperation({ summary: 'Run one tick of every engine now (PDH/PDL + RSI/volume strategies).' })
  async scan() {
    const [pdhl, rsi] = await Promise.all([this.service.runScanTick(), this.rsiEngine.runTick()]);
    return { opened: pdhl.opened + rsi.opened, closed: pdhl.closed + rsi.closed, price: pdhl.price };
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

  @Get('notes')
  @ApiOperation({ summary: 'The trader’s free-text log for this strategy (newest first).' })
  listNotes() {
    return this.service.listNotes();
  }

  @Post('notes')
  @ApiOperation({ summary: 'Save one new note (body + optional image URLs) to the strategy log.' })
  createNote(@Body() body: { body?: string; images?: string[] }) {
    return this.service.createNote(body ?? {});
  }

  @Delete('notes/:id')
  @ApiOperation({ summary: 'Delete one note from the strategy log.' })
  deleteNote(@Param('id') id: string) {
    return this.service.deleteNote(id);
  }

  @Get('doc')
  @ApiOperation({ summary: 'The editable strategy description + params.' })
  getDoc(@Query('strategyId') strategyId?: string) {
    return this.service.getDoc(strategyId || undefined);
  }

  @Put('doc')
  @ApiOperation({ summary: 'Update the editable strategy description / params.' })
  updateDoc(@Body() body: { strategyId?: string; docMarkdown?: string; name?: string; enabled?: boolean; riskUsd?: number; rrPlanned?: number }) {
    return this.service.updateDoc(body ?? {});
  }

  @Post('doc/reset')
  @ApiOperation({ summary: 'Reset the strategy description back to the built-in default.' })
  resetDoc(@Query('strategyId') strategyId?: string) {
    return this.service.resetDoc(strategyId || undefined);
  }
}
