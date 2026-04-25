import { Module } from '@nestjs/common';

import { LlmModule } from '../llm/llm.module';
import { MarketModule } from '../market/market.module';
import { TelegramModule } from '../telegram/telegram.module';
import { AnalysisOrchestratorService } from './analysis-orchestrator.service';
import { DailyAnalysisService } from './daily-analysis.service';
import { PriceActionSignalService } from './price-action-signal.service';
import { SonicRSignalService } from './sonic-r-signal.service';
import { SwingPaService } from './swing-pa.service';
import { SwingPaReviewService } from './swing-pa-review.service';

@Module({
  imports: [MarketModule, TelegramModule, LlmModule],
  providers: [AnalysisOrchestratorService, SonicRSignalService, PriceActionSignalService, DailyAnalysisService, SwingPaReviewService, SwingPaService],
  exports: [AnalysisOrchestratorService, SonicRSignalService, PriceActionSignalService, DailyAnalysisService, SwingPaReviewService, SwingPaService]
})
export class AnalysisModule {}
