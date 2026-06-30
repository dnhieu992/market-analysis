import { Module } from '@nestjs/common';

import { MarketModule } from '../market/market.module';
import { TrackingCoinReviewService } from './tracking-coin-review.service';
import { TrackingCoinScanService } from './tracking-coin-scan.service';

@Module({
  imports: [MarketModule],
  providers: [TrackingCoinScanService, TrackingCoinReviewService],
  exports: [TrackingCoinScanService],
})
export class TrackingCoinScanModule {}
