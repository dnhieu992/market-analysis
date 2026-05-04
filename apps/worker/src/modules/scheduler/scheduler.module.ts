import { Module } from '@nestjs/common';

import { AnalysisModule } from '../analysis/analysis.module';
import { DailySignalModule } from '../daily-signal/daily-signal.module';
import { SwingSignalModule } from '../swing-signal/swing-signal.module';
import { TelegramModule } from '../telegram/telegram.module';
import { VisualAnalysisModule } from '../visual-analysis/visual-analysis.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [AnalysisModule, DailySignalModule, TelegramModule, VisualAnalysisModule, SwingSignalModule],
  providers: [SchedulerService],
  exports: [SchedulerService]
})
export class SchedulerModule {}
