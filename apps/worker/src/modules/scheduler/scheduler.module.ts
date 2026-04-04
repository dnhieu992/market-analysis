import { Module } from '@nestjs/common';

import { AnalysisModule } from '../analysis/analysis.module';
import { TelegramModule } from '../telegram/telegram.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [AnalysisModule, TelegramModule],
  providers: [SchedulerService],
  exports: [SchedulerService]
})
export class SchedulerModule {}
