import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AnalysisModule } from './modules/analysis/analysis.module';
import { BackTestModule } from './modules/back-test/back-test.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuthGuard } from './modules/auth/auth.guard';
import { ChatModule } from './modules/chat/chat.module';
import { DailyAnalysisModule } from './modules/daily-analysis/daily-analysis.module';
import { HealthModule } from './modules/health/health.module';
import { OrdersModule } from './modules/orders/orders.module';
import { SettingsModule } from './modules/settings/settings.module';
import { SignalsModule } from './modules/signals/signals.module';
import { StrategiesModule } from './modules/strategies/strategies.module';
import { TelegramLogsModule } from './modules/telegram-logs/telegram-logs.module';
import { WorkerModule } from './modules/worker/worker.module';

@Module({
  imports: [HealthModule, AuthModule, AnalysisModule, BackTestModule, ChatModule, SignalsModule, OrdersModule, TelegramLogsModule, WorkerModule, DailyAnalysisModule, SettingsModule, StrategiesModule],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard
    }
  ]
})
export class AppModule {}
