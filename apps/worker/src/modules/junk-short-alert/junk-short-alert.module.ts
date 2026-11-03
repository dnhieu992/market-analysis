import { Module } from '@nestjs/common';

import { TelegramModule } from '../telegram/telegram.module';
import { JunkShortAlertService } from './junk-short-alert.service';

@Module({
  imports: [TelegramModule],
  providers: [JunkShortAlertService],
  exports: [JunkShortAlertService],
})
export class JunkShortAlertModule {}
