import { Module } from '@nestjs/common';

import { MarketModule } from '../market/market.module';
import { TelegramModule } from '../telegram/telegram.module';
import { SwingSignalService } from './swing-signal.service';

@Module({
  imports: [MarketModule, TelegramModule],
  providers: [SwingSignalService],
  exports: [SwingSignalService],
})
export class SwingSignalModule {}
