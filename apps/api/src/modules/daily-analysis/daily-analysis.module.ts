import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { DailyAnalysisController } from './daily-analysis.controller';
import { DailyAnalysisService } from './daily-analysis.service';

@Module({
  imports: [DatabaseModule],
  controllers: [DailyAnalysisController],
  providers: [DailyAnalysisService]
})
export class DailyAnalysisModule {}
