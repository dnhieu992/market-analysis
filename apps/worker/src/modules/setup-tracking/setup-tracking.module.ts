import { Module } from '@nestjs/common';

import { MarketModule } from '../market/market.module';
import { TelegramModule } from '../telegram/telegram.module';
import { SetupExtractionService } from './setup-extraction.service';
import { SetupTrackingService } from './setup-tracking.service';

@Module({
  imports: [MarketModule, TelegramModule],
  providers: [SetupExtractionService, SetupTrackingService],
  exports: [SetupExtractionService, SetupTrackingService]
})
export class SetupTrackingModule {}
