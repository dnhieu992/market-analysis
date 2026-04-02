import { Module } from '@nestjs/common';

import { AnalysisModule } from '../analysis/analysis.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [AnalysisModule],
  providers: [SchedulerService],
  exports: [SchedulerService]
})
export class SchedulerModule {}
