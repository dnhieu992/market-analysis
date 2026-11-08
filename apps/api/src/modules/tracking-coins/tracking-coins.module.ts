import { Module } from '@nestjs/common';

import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { MarketModule } from '../market/market.module';
import { TransactionModule } from '../transaction/transaction.module';
import { SpotDailyScanService } from './spot-daily-scan.service';
import { SpotTradesService } from './spot-trades.service';
import { TrackingCoinsController } from './tracking-coins.controller';
import { TrackingCoinsService } from './tracking-coins.service';

@Module({
  imports: [MarketModule, TransactionModule],
  providers: [TrackingCoinsService, SpotTradesService, SpotDailyScanService, BinanceMarketDataService],
  exports: [SpotTradesService],
  controllers: [TrackingCoinsController],
})
export class TrackingCoinsModule {}
