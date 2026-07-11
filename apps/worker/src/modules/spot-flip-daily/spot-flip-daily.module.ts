import { Module } from '@nestjs/common';

import { MarketModule } from '../market/market.module';
import { SpotFlipDailyService } from './spot-flip-daily.service';

@Module({
  imports: [MarketModule],
  providers: [SpotFlipDailyService],
  exports: [SpotFlipDailyService],
})
export class SpotFlipDailyModule {}
