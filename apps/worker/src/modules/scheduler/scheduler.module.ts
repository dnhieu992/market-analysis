import { Module } from '@nestjs/common';

import { AnalysisModule } from '../analysis/analysis.module';
import { BitgetHistoryModule } from '../bitget-history/bitget-history.module';
import { MexcHistoryModule } from '../mexc-history/mexc-history.module';
import { DailySignalModule } from '../daily-signal/daily-signal.module';
import { SwingSignalModule } from '../swing-signal/swing-signal.module';
import { TelegramModule } from '../telegram/telegram.module';
import { VisualAnalysisModule } from '../visual-analysis/visual-analysis.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [AnalysisModule, DailySignalModule, TelegramModule, VisualAnalysisModule, SwingSignalModule, BitgetHistoryModule, MexcHistoryModule],
  providers: [SchedulerService],
  exports: [SchedulerService]
})
export class SchedulerModule {}
