import { Module } from '@nestjs/common';

import { AnalysisModule } from './modules/analysis/analysis.module';
import { ChatModule } from './modules/chat/chat.module';
import { DailyAnalysisModule } from './modules/daily-analysis/daily-analysis.module';
import { HealthModule } from './modules/health/health.module';
import { OrdersModule } from './modules/orders/orders.module';
import { SignalsModule } from './modules/signals/signals.module';
import { TelegramLogsModule } from './modules/telegram-logs/telegram-logs.module';
import { WorkerModule } from './modules/worker/worker.module';

@Module({
  imports: [HealthModule, AnalysisModule, ChatModule, SignalsModule, OrdersModule, TelegramLogsModule, WorkerModule, DailyAnalysisModule]
})
export class AppModule {}
