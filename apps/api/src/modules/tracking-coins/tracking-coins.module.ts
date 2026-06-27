import { Module } from '@nestjs/common';

import { HoldingsModule } from '../holdings/holdings.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { TransactionModule } from '../transaction/transaction.module';
import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { TrackingCoinsController } from './tracking-coins.controller';
import { TrackingCoinsService } from './tracking-coins.service';

@Module({
  imports: [TransactionModule, PortfolioModule, HoldingsModule],
  providers: [TrackingCoinsService, BinanceMarketDataService],
  controllers: [TrackingCoinsController],
})
export class TrackingCoinsModule {}
