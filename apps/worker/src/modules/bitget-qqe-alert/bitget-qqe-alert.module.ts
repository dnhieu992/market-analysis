import { Module } from '@nestjs/common';

import { MarketModule } from '../market/market.module';
import { TelegramModule } from '../telegram/telegram.module';
import { BitgetQqeAlertService } from './bitget-qqe-alert.service';

@Module({
  imports: [MarketModule, TelegramModule],
  providers: [BitgetQqeAlertService],
  exports: [BitgetQqeAlertService],
})
export class BitgetQqeAlertModule {}
