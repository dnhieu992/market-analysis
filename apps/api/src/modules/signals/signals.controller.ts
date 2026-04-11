import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { SignalsService } from './signals.service';
import { QuerySignalsDto } from './dto/query-signals.dto';

@ApiTags('Signals')
@ApiCookieAuth('market_analysis_session')
@Controller('signals')
export class SignalsController {
  constructor(
    @Inject(SignalsService)
    private readonly signalsService: SignalsService
  ) {}

  @Get()
  @ApiOperation({ summary: 'List signals' })
  listSignals(@Query() query: QuerySignalsDto) {
    return this.signalsService.listSignals(query);
  }

  @Get('latest')
  @ApiOperation({ summary: 'Get the latest signal by symbol and timeframe' })
  getLatestSignal(@Query('symbol') symbol: string, @Query('timeframe') timeframe: string) {
    return this.signalsService.getLatestSignal(symbol, timeframe);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a signal by ID' })
  getSignalById(@Param('id') id: string) {
    return this.signalsService.getSignalById(id);
  }
}
