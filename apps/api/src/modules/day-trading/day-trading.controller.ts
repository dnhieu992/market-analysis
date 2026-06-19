import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DayTradingService } from './day-trading.service';
import { QuerySignalsDto } from './dto/query-signals.dto';
import { UpdateDayTradingSettingsDto } from './dto/update-settings.dto';
import { UpdateNoteDto } from './dto/update-note.dto';

@ApiTags('day-trading')
@ApiCookieAuth('market_analysis_session')
@Controller('day-trading')
export class DayTradingController {
  constructor(private readonly service: DayTradingService) {}

  @Get('settings')
  @ApiOperation({ summary: 'Get day trading risk settings' })
  getSettings() {
    return this.service.getSettings();
  }

  @Put('settings')
  @ApiOperation({ summary: 'Update day trading risk settings' })
  updateSettings(@Body() dto: UpdateDayTradingSettingsDto) {
    return this.service.updateSettings(dto);
  }

  @Get('price')
  @ApiOperation({ summary: 'Live BTCUSDT price for open-position monitoring' })
  getPrice() {
    return this.service.getCurrentPrice();
  }

  @Get('signals')
  @ApiOperation({ summary: 'List day trading signals' })
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
