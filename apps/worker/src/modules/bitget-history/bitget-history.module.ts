import { Module } from '@nestjs/common';

import { TradeEntriesModule } from '../trade-entries/trade-entries.module';

import { BitgetHistoryService } from './bitget-history.service';

@Module({
  imports: [TradeEntriesModule],
  providers: [BitgetHistoryService],
  exports: [BitgetHistoryService],
})
export class BitgetHistoryModule {}
