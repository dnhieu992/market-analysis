import { Module } from '@nestjs/common';

import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { SpotFlipController } from './spot-flip.controller';
import { SpotFlipService } from './spot-flip.service';

@Module({
  providers: [SpotFlipService, BinanceMarketDataService],
  controllers: [SpotFlipController],
})
export class SpotFlipModule {}
