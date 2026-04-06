import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { AnalysisModule } from './modules/analysis/analysis.module';
import { EmaSignalModule } from './modules/ema-signal/ema-signal.module';
import { MarketModule } from './modules/market/market.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { TelegramModule } from './modules/telegram/telegram.module';

@Module({
  imports: [ScheduleModule.forRoot(), SchedulerModule, AnalysisModule, MarketModule, TelegramModule, EmaSignalModule]
})
export class WorkerModule {}
