import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';

import { AnalysisModule } from './modules/analysis/analysis.module';
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
import { DcaModule } from './modules/dca/dca.module';
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
    SettingsModule,
    StrategiesModule,
    PortfolioModule,
    TransactionModule,
    HoldingsModule,
    PnlModule,
    UserModule,
    UploadModule,
    SkillsModule,
    DcaModule
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard
    }
  ]
})
export class AppModule {}
