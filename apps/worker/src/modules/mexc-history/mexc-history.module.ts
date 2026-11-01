import { Module } from '@nestjs/common';

import { TradeEntriesModule } from '../trade-entries/trade-entries.module';

import { MexcHistoryService } from './mexc-history.service';

@Module({
  imports: [TradeEntriesModule],
  providers: [MexcHistoryService],
  exports: [MexcHistoryService],
})
export class MexcHistoryModule {}
