import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LongSignalService } from './long-signal.service';
import { QuerySignalsDto } from './dto/query-signals.dto';
import { UpdateLongSignalSettingsDto } from './dto/update-settings.dto';
import { UpdateNoteDto } from './dto/update-note.dto';

@ApiTags('long-signal')
@ApiCookieAuth('market_analysis_session')
@Controller('long-signal')
export class LongSignalController {
  constructor(private readonly service: LongSignalService) {}

  @Get('settings')
  @ApiOperation({ summary: 'Get long-signal strategy settings' })
  getSettings() {
    return this.service.getSettings();
  }

  @Put('settings')
  @ApiOperation({ summary: 'Update long-signal strategy settings' })
  updateSettings(@Body() dto: UpdateLongSignalSettingsDto) {
    return this.service.updateSettings(dto);
  }

  @Get('prices')
  @ApiOperation({ summary: 'Live prices for the basket (open-position monitoring)' })
  getPrices() {
    return this.service.getCurrentPrices();
  }

  @Get('live-status')
  @ApiOperation({ summary: 'Whether LIVE orders are armed (env gate + Bitget credentials)' })
  getLiveStatus() {
    return this.service.getLiveStatus();
  }

  @Get('signals')
  @ApiOperation({ summary: 'List long-signal trades' })
  getSignals(@Query() query: QuerySignalsDto) {
    return this.service.getSignals(query);
  }

  @Get('signals/stats')
  @ApiOperation({ summary: 'Get win rate and P&L statistics' })
  getStats() {
    return this.service.getStats();
  }

  @Get('signals/:id')
  @ApiOperation({ summary: 'Get a single signal with setup context' })
  getSignalById(@Param('id') id: string) {
    return this.service.getSignalById(id);
  }

  @Patch('signals/:id/note')
  @ApiOperation({ summary: 'Add or update the trader note on a signal' })
  updateNote(@Param('id') id: string, @Body() dto: UpdateNoteDto) {
    return this.service.updateNote(id, dto.note);
  }

  @Post('signals/:id/close')
  @ApiOperation({ summary: 'Force-close an open position at the current market price' })
  closeSignal(@Param('id') id: string) {
    return this.service.closeSignal(id);
  }
}
