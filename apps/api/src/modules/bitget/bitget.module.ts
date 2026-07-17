import { Module } from '@nestjs/common';

import { BitgetController } from './bitget.controller';
import { BitgetService } from './bitget.service';

@Module({
  controllers: [BitgetController],
  providers: [BitgetService],
})
export class BitgetModule {}
