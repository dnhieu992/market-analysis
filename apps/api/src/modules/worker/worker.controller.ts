import { Body, Controller, Post } from '@nestjs/common';

import { RunAnalysisDto } from './dto/run-analysis.dto';
import { WorkerService } from './worker.service';

@Controller('worker')
export class WorkerController {
  constructor(private readonly workerService: WorkerService) {}

  @Post('run-analysis')
  runAnalysis(@Body() body: RunAnalysisDto) {
    return this.workerService.runAnalysis(body);
  }
}
