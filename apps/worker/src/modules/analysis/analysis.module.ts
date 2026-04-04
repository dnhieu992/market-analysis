import { Module } from '@nestjs/common';

import { MarketModule } from '../market/market.module';
import { TelegramModule } from '../telegram/telegram.module';
import { AnalysisOrchestratorService } from './analysis-orchestrator.service';
import { PriceActionSignalService } from './price-action-signal.service';
import { SonicRSignalService } from './sonic-r-signal.service';

@Module({
  imports: [MarketModule, TelegramModule],
  providers: [AnalysisOrchestratorService, SonicRSignalService, PriceActionSignalService],
  exports: [AnalysisOrchestratorService, SonicRSignalService, PriceActionSignalService]
})
export class AnalysisModule {}
