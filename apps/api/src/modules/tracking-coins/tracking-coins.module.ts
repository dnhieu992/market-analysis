import { Module } from '@nestjs/common';

import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { MarketModule } from '../market/market.module';
import { TrackingCoinScoreService } from './tracking-coin-score.service';
import { TrackingCoinsController } from './tracking-coins.controller';
import { TrackingCoinsService } from './tracking-coins.service';

@Module({
  imports: [MarketModule],
  providers: [TrackingCoinsService, TrackingCoinScoreService, BinanceMarketDataService],
  controllers: [TrackingCoinsController],
})
export class TrackingCoinsModule {}
