import { Module } from '@nestjs/common';

import { MarketModule } from '../market/market.module';
import { TelegramModule } from '../telegram/telegram.module';
import { AnalysisModule } from '../analysis/analysis.module';
import { SwingSignalModule } from '../swing-signal/swing-signal.module';
import { EmaSignalService } from './ema-signal.service';
import { TelegramPollingService } from './telegram-polling.service';
import { WatchlistService } from './watchlist.service';

@Module({
  imports: [MarketModule, TelegramModule, AnalysisModule, SwingSignalModule],
  providers: [EmaSignalService, TelegramPollingService, WatchlistService]
})
export class EmaSignalModule {}
