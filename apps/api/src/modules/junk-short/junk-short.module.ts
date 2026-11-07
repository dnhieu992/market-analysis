import { Module } from '@nestjs/common';

import { JunkShortController } from './junk-short.controller';
import { JunkShortService } from './junk-short.service';

/** /short-junk coin list CRUD. */
@Module({
  controllers: [JunkShortController],
  providers: [JunkShortService],
})
export class JunkShortModule {}
