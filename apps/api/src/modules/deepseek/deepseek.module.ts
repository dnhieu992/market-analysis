import { Module } from '@nestjs/common';

import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { StorageService } from '../storage/storage.service';
import { BtcDaytradeArchiveService } from './btc-daytrade-archive.service';
import { BtcPaSnapshotService } from './btc-pa-snapshot.service';
import { DeepseekClient } from './deepseek.client';
import { DeepseekController } from './deepseek.controller';
import { DeepseekService } from './deepseek.service';

@Module({
  controllers: [DeepseekController],
  providers: [
    DeepseekService,
    DeepseekClient,
    BtcPaSnapshotService,
    BtcDaytradeArchiveService,
    BinanceMarketDataService,
    StorageService,
  ],
})
export class DeepseekModule {}
