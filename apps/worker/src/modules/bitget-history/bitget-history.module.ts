import { Module } from '@nestjs/common';

import { BitgetHistoryService } from './bitget-history.service';

@Module({
  providers: [BitgetHistoryService],
  exports: [BitgetHistoryService],
})
export class BitgetHistoryModule {}
