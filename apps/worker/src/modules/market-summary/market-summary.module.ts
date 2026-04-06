import { Module } from '@nestjs/common';

import { MarketModule } from '../market/market.module';
import { TelegramModule } from '../telegram/telegram.module';
import { MarketSummaryService } from './market-summary.service';

@Module({
  imports: [MarketModule, TelegramModule],
  providers: [MarketSummaryService]
})
export class MarketSummaryModule {}
