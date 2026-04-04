import { Module } from '@nestjs/common';

import { AnalysisModule } from './modules/analysis/analysis.module';
import { MarketModule } from './modules/market/market.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { TelegramModule } from './modules/telegram/telegram.module';

@Module({
  imports: [SchedulerModule, AnalysisModule, MarketModule, TelegramModule]
})
export class WorkerModule {}
