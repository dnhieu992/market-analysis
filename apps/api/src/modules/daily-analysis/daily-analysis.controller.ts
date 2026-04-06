import { Controller, Get, Inject, Query } from '@nestjs/common';

import type { DailyAnalysisRecord } from './daily-analysis.service';
import { DailyAnalysisService } from './daily-analysis.service';
import type { QueryDailyAnalysisDto } from './dto/query-daily-analysis.dto';

@Controller('daily-analysis')
export class DailyAnalysisController {
  constructor(
    @Inject(DailyAnalysisService)
    private readonly dailyAnalysisService: DailyAnalysisService
  ) {}

  @Get()
  list(@Query() query: QueryDailyAnalysisDto): Promise<DailyAnalysisRecord[]> {
    return this.dailyAnalysisService.list(query.symbol);
  }

  @Get('latest')
  getLatest(@Query('symbol') symbol: string): Promise<DailyAnalysisRecord | null> {
    return this.dailyAnalysisService.getLatest(symbol ?? 'BTCUSDT');
  }
}
