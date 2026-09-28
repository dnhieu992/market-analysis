import { Module } from '@nestjs/common';

import { MarketModule } from '../market/market.module';
import { StrategyPaperTradesController } from './strategy-paper-trades.controller';
import { RsiVolumePaperEngineService } from './rsi-volume-paper-engine.service';
import { StrategyPaperTradesService } from './strategy-paper-trades.service';

@Module({
  imports: [MarketModule],
  controllers: [StrategyPaperTradesController],
  providers: [StrategyPaperTradesService, RsiVolumePaperEngineService],
})
export class StrategyPaperTradesModule {}
