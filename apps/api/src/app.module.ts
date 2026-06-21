import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';

import { AnalysisModule } from './modules/analysis/analysis.module';
import { DayTradingModule } from './modules/day-trading/day-trading.module';
import { SwingTradingModule } from './modules/swing-trading/swing-trading.module';
import { LongSignalModule } from './modules/long-signal/long-signal.module';
import { BackTestModule } from './modules/back-test/back-test.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuthGuard } from './modules/auth/auth.guard';
import { ChatModule } from './modules/chat/chat.module';
import { DailyAnalysisModule } from './modules/daily-analysis/daily-analysis.module';
import { HealthModule } from './modules/health/health.module';
import { HoldingsModule } from './modules/holdings/holdings.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PnlModule } from './modules/pnl/pnl.module';
import { PortfolioModule } from './modules/portfolio/portfolio.module';
import { SettingsModule } from './modules/settings/settings.module';
import { SignalsModule } from './modules/signals/signals.module';
import { StrategiesModule } from './modules/strategies/strategies.module';
import { TelegramLogsModule } from './modules/telegram-logs/telegram-logs.module';
import { TransactionModule } from './modules/transaction/transaction.module';
import { SmallCapRadarModule } from './modules/small-cap-radar/small-cap-radar.module';
import { TrackingCoinsModule } from './modules/tracking-coins/tracking-coins.module';
import { TrackedSetupsModule } from './modules/tracked-setups/tracked-setups.module';
import { SkillsModule } from './modules/skills/skills.module';
import { UploadModule } from './modules/upload/upload.module';
import { UserModule } from './modules/user/user.module';
import { WorkerModule } from './modules/worker/worker.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    HealthModule,
    AuthModule,
    AnalysisModule,
    BackTestModule,
    ChatModule,
    SignalsModule,
    OrdersModule,
    TelegramLogsModule,
    WorkerModule,
    DailyAnalysisModule,
    TrackedSetupsModule,
    SettingsModule,
    StrategiesModule,
    PortfolioModule,
    TransactionModule,
    HoldingsModule,
    PnlModule,
    UserModule,
    UploadModule,
    SkillsModule,
    SmallCapRadarModule,
    TrackingCoinsModule,
    DayTradingModule,
    SwingTradingModule,
    LongSignalModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard
    }
  ]
})
export class AppModule {}
