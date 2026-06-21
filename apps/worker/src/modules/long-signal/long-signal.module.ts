import { Module } from '@nestjs/common';
import { LongSignalBitgetService } from './bitget.service';
import { LongSignalTradeService } from './long-signal-trade.service';
import { LongSignalExecutorService } from './long-signal-executor.service';
import { LongSignalService } from './long-signal.service';

@Module({
  providers: [
    LongSignalBitgetService,
    LongSignalTradeService,
    LongSignalExecutorService,
    LongSignalService,
  ],
  exports: [LongSignalService],
})
export class LongSignalModule {}
