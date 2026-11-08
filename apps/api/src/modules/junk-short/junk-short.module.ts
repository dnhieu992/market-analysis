import { Module } from '@nestjs/common';

import { JunkShortController } from './junk-short.controller';
import { JunkShortDailyScanService } from './junk-short-daily-scan.service';
import { JunkShortService } from './junk-short.service';
import { JunkShortStatsService } from './junk-short-stats.service';

/** /short-junk coin list CRUD + daily setup scan. */
@Module({
  controllers: [JunkShortController],
  providers: [JunkShortService, JunkShortStatsService, JunkShortDailyScanService],
})
export class JunkShortModule {}
