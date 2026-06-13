import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DayTradingService } from './day-trading.service';
import { QuerySignalsDto } from './dto/query-signals.dto';

@ApiTags('day-trading')
@ApiCookieAuth('market_analysis_session')
@Controller('day-trading')
export class DayTradingController {
  constructor(private readonly service: DayTradingService) {}

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
}
