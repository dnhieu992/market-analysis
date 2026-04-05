import { Controller, Get, Inject, Query } from '@nestjs/common';

import { DailyAnalysisService } from './daily-analysis.service';
import type { QueryDailyAnalysisDto } from './dto/query-daily-analysis.dto';

@Controller('daily-analysis')
export class DailyAnalysisController {
  constructor(
    @Inject(DailyAnalysisService)
    private readonly dailyAnalysisService: DailyAnalysisService
  ) {}

  @Get()
  list(@Query() query: QueryDailyAnalysisDto) {
    return this.dailyAnalysisService.list(query.symbol);
  }

  @Get('latest')
  getLatest(@Query('symbol') symbol: string) {
    return this.dailyAnalysisService.getLatest(symbol ?? 'BTCUSDT');
  }
}
