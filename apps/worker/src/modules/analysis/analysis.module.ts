import { Module } from '@nestjs/common';

import { LlmModule } from '../llm/llm.module';
import { MarketModule } from '../market/market.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { TelegramModule } from '../telegram/telegram.module';
import { AnalysisOrchestratorService } from './analysis-orchestrator.service';

@Module({
  imports: [MarketModule, LlmModule, TelegramModule, PersistenceModule],
  providers: [AnalysisOrchestratorService],
  exports: [AnalysisOrchestratorService]
})
export class AnalysisModule {}
