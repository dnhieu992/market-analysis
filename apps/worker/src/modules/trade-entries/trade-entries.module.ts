import { Module } from '@nestjs/common';

import { MarketModule } from '../market/market.module';
import { TradeEntryRecorderService } from './trade-entry-recorder.service';

@Module({
  imports: [MarketModule],
  providers: [TradeEntryRecorderService],
  exports: [TradeEntryRecorderService],
})
export class TradeEntriesModule {}
