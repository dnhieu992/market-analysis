import { Module } from '@nestjs/common';

import { MarketModule } from '../market/market.module';
import { TrackingCoinScanService } from './tracking-coin-scan.service';

@Module({
  imports: [MarketModule],
  providers: [TrackingCoinScanService],
  exports: [TrackingCoinScanService],
})
export class TrackingCoinScanModule {}
