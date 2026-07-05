import { Module } from '@nestjs/common';

import { MarketModule } from '../market/market.module';
import { MemeScanService } from './meme-scan.service';

@Module({
  imports: [MarketModule],
  providers: [MemeScanService],
  exports: [MemeScanService],
})
export class MemeScanModule {}
