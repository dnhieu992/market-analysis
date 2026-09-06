import { Module } from '@nestjs/common';

import { BinanceMarketDataService } from './binance-market-data.service';
import { DailyCandleCacheService } from './daily-candle-cache.service';
import { MarketDataService } from './market-data.service';

@Module({
  providers: [BinanceMarketDataService, MarketDataService, DailyCandleCacheService],
  exports: [MarketDataService, DailyCandleCacheService]
})
export class MarketModule {}
