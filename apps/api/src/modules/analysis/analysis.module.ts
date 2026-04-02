import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { AnalysisController } from './analysis.controller';
import { AnalysisService } from './analysis.service';

@Module({
  imports: [DatabaseModule],
  controllers: [AnalysisController],
  providers: [AnalysisService],
  exports: [AnalysisService]
})
export class AnalysisModule {}
