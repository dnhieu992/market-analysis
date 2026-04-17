import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { AnalysisModule } from './modules/analysis/analysis.module';
import { MarketModule } from './modules/market/market.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { SwingSignalModule } from './modules/swing-signal/swing-signal.module';
import { TelegramModule } from './modules/telegram/telegram.module';

@Module({
  imports: [ScheduleModule.forRoot(), SchedulerModule, AnalysisModule, MarketModule, TelegramModule, SwingSignalModule]
})
export class WorkerModule {}
