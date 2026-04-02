import { Controller, Get, Inject, Param, Query } from '@nestjs/common';

import { AnalysisService } from './analysis.service';
import type { QueryAnalysisRunsDto } from './dto/query-analysis-runs.dto';

@Controller('analysis-runs')
export class AnalysisController {
  constructor(
    @Inject(AnalysisService)
    private readonly analysisService: AnalysisService
  ) {}

  @Get()
  listAnalysisRuns(@Query() query: QueryAnalysisRunsDto) {
    return this.analysisService.listAnalysisRuns(query);
  }

  @Get('latest')
  getLatestAnalysisRun(@Query('symbol') symbol: string, @Query('timeframe') timeframe: string) {
    return this.analysisService.getLatestAnalysisRun(symbol, timeframe);
  }

  @Get(':id')
  getAnalysisRunById(@Param('id') id: string) {
    return this.analysisService.getAnalysisRunById(id);
  }
}
