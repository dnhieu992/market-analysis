import { Module } from '@nestjs/common';

import { MarketModule } from '../market/market.module';
import { TelegramModule } from '../telegram/telegram.module';
import { EmaSignalService } from './ema-signal.service';
import { TelegramPollingService } from './telegram-polling.service';

@Module({
  imports: [MarketModule, TelegramModule],
  providers: [EmaSignalService, TelegramPollingService]
})
export class EmaSignalModule {}
