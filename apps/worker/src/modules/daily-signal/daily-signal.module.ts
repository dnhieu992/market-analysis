import { Module } from '@nestjs/common';

import { MarketModule } from '../market/market.module';
import { TelegramModule } from '../telegram/telegram.module';
import { DailySignalService } from './daily-signal.service';

@Module({
  imports: [MarketModule, TelegramModule],
  providers: [DailySignalService],
  exports: [DailySignalService],
})
export class DailySignalModule {}
