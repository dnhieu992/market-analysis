import { Body, Controller, Inject, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { WorkerService } from './worker.service';
import { RunAnalysisDto } from './dto/run-analysis.dto';

@ApiTags('Worker')
@ApiCookieAuth('market_analysis_session')
@Controller('worker')
export class WorkerController {
  constructor(
    @Inject(WorkerService)
    private readonly workerService: WorkerService
  ) {}

  @Post('run-analysis')
  @ApiOperation({ summary: 'Trigger a manual analysis run' })
  runAnalysis(@Body() body: RunAnalysisDto) {
    return this.workerService.runAnalysis(body);
  }
}
