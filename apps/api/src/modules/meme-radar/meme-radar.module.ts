import { Module } from '@nestjs/common';

import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { MemeRadarController } from './meme-radar.controller';
import { MemeRadarService } from './meme-radar.service';

@Module({
  providers: [MemeRadarService, BinanceMarketDataService],
  controllers: [MemeRadarController],
})
export class MemeRadarModule {}
