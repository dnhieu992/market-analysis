import { Module } from '@nestjs/common';

import { MarketModule } from '../market/market.module';
import { TelegramModule } from '../telegram/telegram.module';
import { EmaStochScanService } from './ema-stoch-scan.service';

@Module({
  imports: [MarketModule, TelegramModule],
  providers: [EmaStochScanService],
  exports: [EmaStochScanService],
})
export class EmaStochScanModule {}
