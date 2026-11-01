import { Module } from '@nestjs/common';

import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { TradeEntriesController } from './trade-entries.controller';
import { TradeEntryService } from './trade-entry.service';

@Module({
  controllers: [TradeEntriesController],
  providers: [TradeEntryService, BinanceMarketDataService],
  // Bitget / MEXC services record order intents; the chat tools read reviews.
  exports: [TradeEntryService],
})
export class TradeEntriesModule {}
