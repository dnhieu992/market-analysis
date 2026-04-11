import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { DailyAnalysisRecord } from './daily-analysis.service';
import { DailyAnalysisService } from './daily-analysis.service';
import { QueryDailyAnalysisDto } from './dto/query-daily-analysis.dto';

@ApiTags('Daily Analysis')
@ApiCookieAuth('market_analysis_session')
@Controller('daily-analysis')
export class DailyAnalysisController {
  constructor(
    @Inject(DailyAnalysisService)
    private readonly dailyAnalysisService: DailyAnalysisService
  ) {}

  @Get()
  @ApiOperation({ summary: 'List daily analysis records' })
  list(@Query() query: QueryDailyAnalysisDto): Promise<DailyAnalysisRecord[]> {
    return this.dailyAnalysisService.list(query.symbol);
  }

  @Get('latest')
  @ApiOperation({ summary: 'Get the latest daily analysis for a symbol' })
  getLatest(@Query('symbol') symbol: string): Promise<DailyAnalysisRecord | null> {
    return this.dailyAnalysisService.getLatest(symbol ?? 'BTCUSDT');
  }
}
