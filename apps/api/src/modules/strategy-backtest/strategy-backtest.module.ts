import { Module } from '@nestjs/common';

import { MarketModule } from '../market/market.module';
import { StrategyBacktestController } from './strategy-backtest.controller';
import { StrategyBacktestService } from './strategy-backtest.service';

@Module({
  imports: [MarketModule],
  controllers: [StrategyBacktestController],
  providers: [StrategyBacktestService],
})
export class StrategyBacktestModule {}
