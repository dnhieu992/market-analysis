import { Module } from '@nestjs/common';

import { AnalysisModule } from '../analysis/analysis.module';
import { BitgetHistoryModule } from '../bitget-history/bitget-history.module';
import { MexcHistoryModule } from '../mexc-history/mexc-history.module';
import { OkxHistoryModule } from '../okx-history/okx-history.module';
import { DailySignalModule } from '../daily-signal/daily-signal.module';
import { SwingSignalModule } from '../swing-signal/swing-signal.module';
import { SchedulerService } from './scheduler.service';

// VisualAnalysisModule / TelegramModule dropped here on 2026-08-05 with the auto
// daily plan — the scheduler no longer sends anything to Telegram itself.
@Module({
  imports: [AnalysisModule, DailySignalModule, SwingSignalModule, BitgetHistoryModule, MexcHistoryModule, OkxHistoryModule],
  providers: [SchedulerService],
  exports: [SchedulerService]
})
export class SchedulerModule {}
