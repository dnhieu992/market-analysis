import { Module } from '@nestjs/common';

import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { TopCapRadarController } from './top-cap-radar.controller';
import { TopCapRadarService } from './top-cap-radar.service';

@Module({
  providers: [TopCapRadarService, BinanceMarketDataService],
  controllers: [TopCapRadarController],
})
export class TopCapRadarModule {}
