import { Module } from '@nestjs/common';

import { BinanceMarketDataService } from './binance-market-data.service';
import { MarketDataService } from './market-data.service';

@Module({
  providers: [BinanceMarketDataService, MarketDataService],
  exports: [MarketDataService]
})
export class MarketModule {}
