import { Module } from '@nestjs/common';

import { AnalysisModule } from './modules/analysis/analysis.module';
import { LlmModule } from './modules/llm/llm.module';
import { MarketModule } from './modules/market/market.module';
import { PersistenceModule } from './modules/persistence/persistence.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { TelegramModule } from './modules/telegram/telegram.module';

@Module({
  imports: [SchedulerModule, AnalysisModule, MarketModule, LlmModule, TelegramModule, PersistenceModule]
})
export class WorkerModule {}
