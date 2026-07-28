import { Module } from '@nestjs/common';

import { MexcHistoryService } from './mexc-history.service';

@Module({
  providers: [MexcHistoryService],
  exports: [MexcHistoryService],
})
export class MexcHistoryModule {}
