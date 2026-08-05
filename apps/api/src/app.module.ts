import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';

import { AnalysisModule } from './modules/analysis/analysis.module';
import { AssetModule } from './modules/asset/asset.module';
import { BitgetModule } from './modules/bitget/bitget.module';
import { MexcModule } from './modules/mexc/mexc.module';
import { BackTestModule } from './modules/back-test/back-test.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuthGuard } from './modules/auth/auth.guard';
import { ChatModule } from './modules/chat/chat.module';
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
import { TrackingCoinsModule } from './modules/tracking-coins/tracking-coins.module';
import { SkillsModule } from './modules/skills/skills.module';
import { SupertrendScanModule } from './modules/supertrend-scan/supertrend-scan.module';
import { UploadModule } from './modules/upload/upload.module';
import { StorageModule } from './modules/storage/storage.module';
import { UserModule } from './modules/user/user.module';
import { WorkerModule } from './modules/worker/worker.module';
import { JournalModule } from './modules/journal/journal.module';

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
    SettingsModule,
    StrategiesModule,
    PortfolioModule,
    TransactionModule,
    HoldingsModule,
    PnlModule,
    UserModule,
    UploadModule,
    StorageModule,
    SkillsModule,
    TrackingCoinsModule,
    SupertrendScanModule,
    BitgetModule,
    MexcModule,
    JournalModule,
    AssetModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard
    }
  ]
})
export class AppModule {}
