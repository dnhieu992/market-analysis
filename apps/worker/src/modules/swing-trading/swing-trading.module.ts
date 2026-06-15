import { Module } from '@nestjs/common';
import { SwingBitgetService } from './bitget.service';
import { UtBotStrategyService } from './utbot-strategy.service';
import { SwingExecutorService } from './swing-executor.service';
import { SwingTradingService } from './swing-trading.service';

@Module({
  providers: [
    SwingBitgetService,
    UtBotStrategyService,
    SwingExecutorService,
    SwingTradingService,
  ],
  exports: [SwingTradingService],
})
export class SwingTradingModule {}
