import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { AnalysisModule } from './modules/analysis/analysis.module';
import { DayTradingModule } from './modules/day-trading/day-trading.module';
import { DcaLadderModule } from './modules/dca-ladder/dca-ladder.module';
import { EmaSignalModule } from './modules/ema-signal/ema-signal.module';
import { MarketModule } from './modules/market/market.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { SwingSignalModule } from './modules/swing-signal/swing-signal.module';
import { LongSignalModule } from './modules/long-signal/long-signal.module';
import { TelegramModule } from './modules/telegram/telegram.module';

@Module({
  imports: [ScheduleModule.forRoot(), SchedulerModule, AnalysisModule, DayTradingModule, DcaLadderModule, EmaSignalModule, MarketModule, TelegramModule, SwingSignalModule, LongSignalModule]
})
export class WorkerModule {}
