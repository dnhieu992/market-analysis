import { Controller, Get, Param, Query } from '@nestjs/common';

import { QuerySignalsDto } from './dto/query-signals.dto';
import { SignalsService } from './signals.service';

@Controller('signals')
export class SignalsController {
  constructor(private readonly signalsService: SignalsService) {}

  @Get()
  listSignals(@Query() query: QuerySignalsDto) {
    return this.signalsService.listSignals(query);
  }

  @Get('latest')
  getLatestSignal(@Query('symbol') symbol: string, @Query('timeframe') timeframe: string) {
    return this.signalsService.getLatestSignal(symbol, timeframe);
  }

  @Get(':id')
  getSignalById(@Param('id') id: string) {
    return this.signalsService.getSignalById(id);
  }
}
