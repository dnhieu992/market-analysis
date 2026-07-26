import { Module } from '@nestjs/common';

import { AnalysisModule } from '../analysis/analysis.module';
import { BitgetHistoryModule } from '../bitget-history/bitget-history.module';
import { DailySignalModule } from '../daily-signal/daily-signal.module';
import { SetupTrackingModule } from '../setup-tracking/setup-tracking.module';
import { SmallCapScanModule } from '../small-cap-scan/small-cap-scan.module';
import { MemeScanModule } from '../meme-scan/meme-scan.module';
import { SwingSignalModule } from '../swing-signal/swing-signal.module';
import { TelegramModule } from '../telegram/telegram.module';
import { VisualAnalysisModule } from '../visual-analysis/visual-analysis.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [AnalysisModule, DailySignalModule, TelegramModule, VisualAnalysisModule, SwingSignalModule, SmallCapScanModule, MemeScanModule, SetupTrackingModule, BitgetHistoryModule],
  providers: [SchedulerService],
  exports: [SchedulerService]
})
export class SchedulerModule {}
