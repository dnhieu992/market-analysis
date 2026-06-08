import { Module } from '@nestjs/common';

import { MarketModule } from '../market/market.module';
import { SmallCapScanService } from './small-cap-scan.service';

@Module({
  imports: [MarketModule],
  providers: [SmallCapScanService],
  exports: [SmallCapScanService],
})
export class SmallCapScanModule {}
