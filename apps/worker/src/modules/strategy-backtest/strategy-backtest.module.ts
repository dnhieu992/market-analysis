import { Module } from '@nestjs/common';

import { MarketModule } from '../market/market.module';
import { StrategyBacktestScanService } from './strategy-backtest-scan.service';

@Module({
  imports: [MarketModule],
  providers: [StrategyBacktestScanService],
  exports: [StrategyBacktestScanService],
})
export class StrategyBacktestModule {}
