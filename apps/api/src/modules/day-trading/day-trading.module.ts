import { Module } from '@nestjs/common';
import { DayTradingController } from './day-trading.controller';
import { DayTradingService } from './day-trading.service';

@Module({
  controllers: [DayTradingController],
  providers: [DayTradingService],
})
export class DayTradingModule {}
