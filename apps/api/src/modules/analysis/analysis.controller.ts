import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AnalysisService } from './analysis.service';
import { QueryAnalysisRunsDto } from './dto/query-analysis-runs.dto';

@ApiTags('Analysis')
@ApiCookieAuth('market_analysis_session')
@Controller('analysis-runs')
export class AnalysisController {
  constructor(
    @Inject(AnalysisService)
    private readonly analysisService: AnalysisService
  ) {}

  @Get()
  @ApiOperation({ summary: 'List analysis runs' })
  listAnalysisRuns(@Query() query: QueryAnalysisRunsDto) {
    return this.analysisService.listAnalysisRuns(query);
  }

  @Get('latest')
  @ApiOperation({ summary: 'Get the latest analysis run by symbol and timeframe' })
  getLatestAnalysisRun(@Query('symbol') symbol: string, @Query('timeframe') timeframe: string) {
    return this.analysisService.getLatestAnalysisRun(symbol, timeframe);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an analysis run by ID' })
  getAnalysisRunById(@Param('id') id: string) {
    return this.analysisService.getAnalysisRunById(id);
  }
}
