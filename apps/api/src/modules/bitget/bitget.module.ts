import { Module } from '@nestjs/common';

import { BitgetController } from './bitget.controller';
import { BitgetJournalService } from './bitget-journal.service';
import { BitgetService } from './bitget.service';
import { BitgetSetupService } from './bitget-setup.service';

@Module({
  controllers: [BitgetController],
  providers: [BitgetService, BitgetJournalService, BitgetSetupService],
})
export class BitgetModule {}
