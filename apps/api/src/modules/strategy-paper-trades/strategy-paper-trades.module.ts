import { Module } from '@nestjs/common';

import { MarketModule } from '../market/market.module';
import { StrategyPaperTradesController } from './strategy-paper-trades.controller';
import { RsiVolumePaperEngineService } from './rsi-volume-paper-engine.service';
import { ScalpSkillPaperService } from './scalp-skill-paper.service';
import { StrategyPaperTradesService } from './strategy-paper-trades.service';

@Module({
  imports: [MarketModule],
  controllers: [StrategyPaperTradesController],
  providers: [StrategyPaperTradesService, RsiVolumePaperEngineService, ScalpSkillPaperService],
})
export class StrategyPaperTradesModule {}
