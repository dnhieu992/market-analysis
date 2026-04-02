import { Body, Controller, Inject, Post } from '@nestjs/common';

import { WorkerService } from './worker.service';
import type { RunAnalysisDto } from './dto/run-analysis.dto';

@Controller('worker')
export class WorkerController {
  constructor(
    @Inject(WorkerService)
    private readonly workerService: WorkerService
  ) {}

  @Post('run-analysis')
  runAnalysis(@Body() body: RunAnalysisDto) {
    return this.workerService.runAnalysis(body);
  }
}
