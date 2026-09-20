import { Module } from '@nestjs/common';

import { MarketModule } from '../market/market.module';
import { StrategyPaperTradesController } from './strategy-paper-trades.controller';
import { StrategyPaperTradesService } from './strategy-paper-trades.service';

@Module({
  imports: [MarketModule],
  controllers: [StrategyPaperTradesController],
  providers: [StrategyPaperTradesService],
})
export class StrategyPaperTradesModule {}
