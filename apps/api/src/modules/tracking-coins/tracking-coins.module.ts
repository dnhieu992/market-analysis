import { Module } from '@nestjs/common';

import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { TrackingCoinsController } from './tracking-coins.controller';
import { TrackingCoinsService } from './tracking-coins.service';

@Module({
  providers: [TrackingCoinsService, BinanceMarketDataService],
  controllers: [TrackingCoinsController],
})
export class TrackingCoinsModule {}
