import { Module } from '@nestjs/common';

import { MarketModule } from '../market/market.module';
import { TelegramModule } from '../telegram/telegram.module';
import { SupertrendH4ScanService } from './supertrend-h4-scan.service';
import { SupertrendScanController } from './supertrend-scan.controller';
import { SupertrendScanService } from './supertrend-scan.service';
import { TrackingScanSymbolsService } from './tracking-scan-symbols.service';

@Module({
  imports: [MarketModule, TelegramModule],
  controllers: [SupertrendScanController],
  providers: [SupertrendScanService, SupertrendH4ScanService, TrackingScanSymbolsService],
})
export class SupertrendScanModule {}
