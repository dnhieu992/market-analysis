import { Body, Controller, Get, Param, Patch, Put, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SwingTradingService } from './swing-trading.service';
import { QuerySignalsDto } from './dto/query-signals.dto';
import { UpdateSwingTradingSettingsDto } from './dto/update-settings.dto';
import { UpdateNoteDto } from './dto/update-note.dto';

@ApiTags('swing-trading')
@ApiCookieAuth('market_analysis_session')
@Controller('swing-trading')
export class SwingTradingController {
  constructor(private readonly service: SwingTradingService) {}

  @Get('settings')
  @ApiOperation({ summary: 'Get swing trading strategy + risk settings' })
  getSettings() {
    return this.service.getSettings();
  }

  @Put('settings')
  @ApiOperation({ summary: 'Update swing trading strategy + risk settings' })
  updateSettings(@Body() dto: UpdateSwingTradingSettingsDto) {
    return this.service.updateSettings(dto);
  }

  @Get('price')
  @ApiOperation({ summary: 'Live price for a symbol (open-position monitoring)' })
  getPrice(@Query('symbol') symbol?: string) {
    return this.service.getCurrentPrice(symbol);
  }

  @Get('signals')
  @ApiOperation({ summary: 'List swing trading signals' })
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
}
