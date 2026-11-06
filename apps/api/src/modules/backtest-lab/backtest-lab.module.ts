import { Module } from '@nestjs/common';

import { BacktestLabService } from './backtest-lab.service';

/** Sandboxed backtests requested from the AI chats ("/backtest …"). */
@Module({
  providers: [BacktestLabService],
  exports: [BacktestLabService],
})
export class BacktestLabModule {}
