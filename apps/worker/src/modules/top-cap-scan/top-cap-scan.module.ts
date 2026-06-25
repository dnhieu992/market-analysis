import { Module } from '@nestjs/common';

import { MarketModule } from '../market/market.module';
import { TopCapScanService } from './top-cap-scan.service';

@Module({
  imports: [MarketModule],
  providers: [TopCapScanService],
  exports: [TopCapScanService],
})
export class TopCapScanModule {}
