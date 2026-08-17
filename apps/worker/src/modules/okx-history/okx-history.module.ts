import { Module } from '@nestjs/common';

import { OkxHistoryService } from './okx-history.service';

@Module({
  providers: [OkxHistoryService],
  exports: [OkxHistoryService],
})
export class OkxHistoryModule {}
