import { Module } from '@nestjs/common';

import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { AssetController } from './asset.controller';
import { AssetService } from './asset.service';

@Module({
  controllers: [AssetController],
  // Binance prices value the spot book so /my-asset can report unrealized PnL.
  providers: [AssetService, BinanceMarketDataService],
})
export class AssetModule {}
