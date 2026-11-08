import { Module } from '@nestjs/common';

import { TelegramModule } from '../telegram/telegram.module';
import { OrderFillNotifyService } from './order-fill-notify.service';

@Module({
  imports: [TelegramModule],
  providers: [OrderFillNotifyService],
  exports: [OrderFillNotifyService],
})
export class OrderFillNotifyModule {}
