import { Module } from '@nestjs/common';

import { JunkShortController } from './junk-short.controller';
import { JunkShortService } from './junk-short.service';
import { JunkShortStatsService } from './junk-short-stats.service';

/** /short-junk coin list CRUD. */
@Module({
  controllers: [JunkShortController],
  providers: [JunkShortService, JunkShortStatsService],
})
export class JunkShortModule {}
