import { Module } from '@nestjs/common';

import { TradingListController } from './trading-list.controller';
import { TradingListService } from './trading-list.service';

@Module({
  controllers: [TradingListController],
  providers: [TradingListService],
  // The /trading-list AI chat (ChatModule) reads the shared stars/notes through it.
  exports: [TradingListService],
})
export class TradingListModule {}
