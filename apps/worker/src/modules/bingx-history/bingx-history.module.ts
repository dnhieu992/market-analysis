import { Module } from '@nestjs/common';

import { BingxHistoryService } from './bingx-history.service';

@Module({
  providers: [BingxHistoryService],
  exports: [BingxHistoryService],
})
export class BingxHistoryModule {}
