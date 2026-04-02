import { Controller, Get, Inject, Param, Query } from '@nestjs/common';

import { SignalsService } from './signals.service';
import type { QuerySignalsDto } from './dto/query-signals.dto';

@Controller('signals')
export class SignalsController {
  constructor(
    @Inject(SignalsService)
    private readonly signalsService: SignalsService
  ) {}

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
