import { Module } from '@nestjs/common';

import { AnalysisModule } from '../analysis/analysis.module';
import { DailySignalModule } from '../daily-signal/daily-signal.module';
import { DcaLadderModule } from '../dca-ladder/dca-ladder.module';
import { SetupTrackingModule } from '../setup-tracking/setup-tracking.module';
import { SmallCapScanModule } from '../small-cap-scan/small-cap-scan.module';
import { SwingSignalModule } from '../swing-signal/swing-signal.module';
import { TelegramModule } from '../telegram/telegram.module';
import { TrackingCoinScanModule } from '../tracking-coin-scan/tracking-coin-scan.module';
import { VisualAnalysisModule } from '../visual-analysis/visual-analysis.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [AnalysisModule, DailySignalModule, TelegramModule, VisualAnalysisModule, SwingSignalModule, SmallCapScanModule, TrackingCoinScanModule, SetupTrackingModule, DcaLadderModule],
  providers: [SchedulerService],
  exports: [SchedulerService]
})
export class SchedulerModule {}
