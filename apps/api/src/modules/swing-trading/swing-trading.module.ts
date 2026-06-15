import { Module } from '@nestjs/common';
import { SwingTradingController } from './swing-trading.controller';
import { SwingTradingService } from './swing-trading.service';

@Module({
  controllers: [SwingTradingController],
  providers: [SwingTradingService],
})
export class SwingTradingModule {}
