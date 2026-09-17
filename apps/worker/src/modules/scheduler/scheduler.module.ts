import { Module } from '@nestjs/common';

import { AnalysisModule } from '../analysis/analysis.module';
import { BingxHistoryModule } from '../bingx-history/bingx-history.module';
import { BitgetHistoryModule } from '../bitget-history/bitget-history.module';
import { BitgetQqeAlertModule } from '../bitget-qqe-alert/bitget-qqe-alert.module';
import { MexcHistoryModule } from '../mexc-history/mexc-history.module';
import { SwingSignalModule } from '../swing-signal/swing-signal.module';
import { StrategyBacktestModule } from '../strategy-backtest/strategy-backtest.module';
import { SchedulerService } from './scheduler.service';

// VisualAnalysisModule / TelegramModule dropped here on 2026-08-05 with the auto
// daily plan — the scheduler no longer sends anything to Telegram itself.
// DailySignalModule (the "Coins can long today" message) dropped 2026-09-09 at
// the trader's request — see docs/features/daily-long-signal/ (kept as a design
// reference, marked REMOVED).
@Module({
  imports: [
    AnalysisModule,
    SwingSignalModule,
    BitgetHistoryModule,
    BitgetQqeAlertModule,
    MexcHistoryModule,
    BingxHistoryModule,
    StrategyBacktestModule
  ],
  providers: [SchedulerService],
  exports: [SchedulerService]
})
export class SchedulerModule {}
