import { Controller, Get, Param, Query } from '@nestjs/common';

import { QueryAnalysisRunsDto } from './dto/query-analysis-runs.dto';
import { AnalysisService } from './analysis.service';

@Controller('analysis-runs')
export class AnalysisController {
  constructor(private readonly analysisService: AnalysisService) {}

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
