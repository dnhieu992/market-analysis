import { Module } from '@nestjs/common';

import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { DeepseekClient } from './deepseek.client';
import { DeepseekController } from './deepseek.controller';
import { DeepseekService } from './deepseek.service';
import { MarketSnapshotService } from './market-snapshot.service';

@Module({
  controllers: [DeepseekController],
  providers: [DeepseekService, DeepseekClient, MarketSnapshotService, BinanceMarketDataService],
})
export class DeepseekModule {}
