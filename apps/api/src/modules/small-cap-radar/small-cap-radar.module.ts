import { Module } from '@nestjs/common';

import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { SmallCapRadarController } from './small-cap-radar.controller';
import { SmallCapRadarService } from './small-cap-radar.service';

@Module({
  providers: [SmallCapRadarService, BinanceMarketDataService],
  controllers: [SmallCapRadarController],
})
export class SmallCapRadarModule {}
