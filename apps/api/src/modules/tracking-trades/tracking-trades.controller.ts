import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { SetupInput } from './tracking-setup-factory';
import { TrackingTradesService } from './tracking-trades.service';

type Reason = { reason?: string };

@ApiTags('Tracking Trades')
@ApiCookieAuth('market_analysis_session')
@Controller('tracking-trades')
export class TrackingTradesController {
  constructor(private readonly service: TrackingTradesService) {}

  @Get()
  @ApiOperation({ summary: 'All swing setups of /tracking-coins + stats, risk config and lesson batches.' })
  overview() {
    return this.service.overview();
  }

  @Get('active-by-coin')
  @ApiOperation({ summary: 'Active setups (proposed / watching / pending / open) grouped by coin.' })
  activeByCoin() {
    return this.service.activeByCoin();
  }

  @Get('coin/:symbol')
  @ApiOperation({ summary: 'One coin: its setups and timeline.' })
  coin(@Param('symbol') symbol: string) {
    return this.service.listForSymbol(symbol);
  }

  @Post()
  @ApiOperation({ summary: 'Create a setup by hand (WATCHING, or placed at once with place: true).' })
  create(@Body() body: SetupInput & { place?: boolean }) {
    return this.service.createManual(body);
  }

  @Put('config')
  @ApiOperation({ summary: 'Risk per setup (1R in USD).' })
  config(@Body() body: { riskUsd: number }) {
    return this.service.updateConfig(Number(body?.riskUsd));
  }

  @Post('notes')
  @ApiOperation({ summary: 'Hand-written note (markdown + image URLs) on a coin or a setup.' })
  addNote(@Body() body: { symbol: string; setupId?: string | null; message: string; images?: string[] }) {
    return this.service.addNote(body);
  }

  @Delete('notes/:id')
  deleteNote(@Param('id') id: string) {
    return this.service.deleteNote(id);
  }

  @Post('lessons/draft')
  @ApiOperation({ summary: 'Draft the next lesson batch now (needs 100 closed setups not yet in a batch).' })
  draftLessons() {
    return this.service.maybeDraftLessons(true);
  }

  @Put('lessons/:id')
  @ApiOperation({ summary: 'Save the edited lessons; approve: true feeds them into later analyses.' })
  saveLessons(@Param('id') id: string, @Body() body: { content: string; approve?: boolean }) {
    return this.service.saveLessons(id, body?.content, Boolean(body?.approve));
  }

  @Post('tick')
  @ApiOperation({ summary: 'Run the paper monitor once now.' })
  tick() {
    return this.service.runTick();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.getSetup(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Edit a plan that has not been placed yet.' })
  edit(@Param('id') id: string, @Body() body: Partial<SetupInput>) {
    return this.service.edit(id, body ?? {});
  }

  @Post(':id/watch')
  watch(@Param('id') id: string) {
    return this.service.watch(id);
  }

  @Post(':id/place')
  place(@Param('id') id: string, @Body() body: Partial<Pick<SetupInput, 'entryPrice' | 'stopLoss' | 'orderType'>>) {
    return this.service.place(id, body ?? {});
  }

  @Post(':id/discard')
  discard(@Param('id') id: string, @Body() body: Reason) {
    return this.service.discard(id, body?.reason ?? '');
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Body() body: Reason) {
    return this.service.cancel(id, body?.reason ?? '');
  }

  @Post(':id/move-stop')
  moveStop(@Param('id') id: string, @Body() body: { price: number; reason: string }) {
    return this.service.moveStop(id, Number(body?.price), body?.reason ?? '');
  }

  @Post(':id/close')
  close(@Param('id') id: string, @Body() body: { pct: number; reason: string }) {
    return this.service.closeManual(id, Number(body?.pct), body?.reason ?? '');
  }

  @Post(':id/review')
  review(@Param('id') id: string, @Body() body: { rating?: number | null; note?: string | null }) {
    return this.service.review(id, body?.rating ?? null, body?.note ?? null);
  }

  @Post(':id/postmortem')
  @ApiOperation({ summary: 'Re-write the Claude post-mortem of a closed setup.' })
  postMortem(@Param('id') id: string) {
    return this.service.writePostMortem(id);
  }
}
