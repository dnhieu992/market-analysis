import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';

import { AnalysisModule } from './modules/analysis/analysis.module';
import { BitgetModule } from './modules/bitget/bitget.module';
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
import { MemeRadarModule } from './modules/meme-radar/meme-radar.module';
import { SpotFlipModule } from './modules/spot-flip/spot-flip.module';
import { TrackingCoinsModule } from './modules/tracking-coins/tracking-coins.module';
import { TrackedSetupsModule } from './modules/tracked-setups/tracked-setups.module';
import { SkillsModule } from './modules/skills/skills.module';
import { UploadModule } from './modules/upload/upload.module';
import { StorageModule } from './modules/storage/storage.module';
import { UserModule } from './modules/user/user.module';
import { WorkerModule } from './modules/worker/worker.module';
import { DcaLadderModule } from './modules/dca-ladder/dca-ladder.module';
import { PatternScannerModule } from './modules/pattern-scanner/pattern-scanner.module';
import { EmaStochScannerModule } from './modules/ema-stoch-scanner/ema-stoch-scanner.module';
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
    StorageModule,
    SkillsModule,
    SmallCapRadarModule,
    MemeRadarModule,
    SpotFlipModule,
    TrackingCoinsModule,
    BitgetModule,
    DcaLadderModule,
    PatternScannerModule,
    EmaStochScannerModule,
    JournalModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard
    }
  ]
})
export class AppModule {}
