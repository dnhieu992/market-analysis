import { Module } from '@nestjs/common';

import { MarketModule } from '../market/market.module';
import { TelegramModule } from '../telegram/telegram.module';
import { SupertrendScanController } from './supertrend-scan.controller';
import { SupertrendScanService } from './supertrend-scan.service';

@Module({
  imports: [MarketModule, TelegramModule],
  controllers: [SupertrendScanController],
  providers: [SupertrendScanService],
})
export class SupertrendScanModule {}
