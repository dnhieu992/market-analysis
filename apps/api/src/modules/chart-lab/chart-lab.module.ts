import { Module } from '@nestjs/common';

import { ClaudeChatProvider } from '../chat/providers/claude-chat.provider';
import { DatabaseModule } from '../database/database.module';
import { ChartLabController } from './chart-lab.controller';
import { ChartLabService } from './chart-lab.service';

/** /chart-lab: chart screenshot library — Claude reads each chart, the server scores what happened next. */
@Module({
  imports: [DatabaseModule],
  controllers: [ChartLabController],
  providers: [ChartLabService, ClaudeChatProvider],
  exports: [ChartLabService],
})
export class ChartLabModule {}
