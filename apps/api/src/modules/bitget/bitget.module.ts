import { Module } from '@nestjs/common';

import { BitgetController } from './bitget.controller';
import { BitgetJournalService } from './bitget-journal.service';
import { BitgetService } from './bitget.service';

@Module({
  controllers: [BitgetController],
  providers: [BitgetService, BitgetJournalService],
})
export class BitgetModule {}
