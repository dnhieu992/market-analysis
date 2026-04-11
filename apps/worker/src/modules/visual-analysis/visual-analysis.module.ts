import { Module } from '@nestjs/common';

import { ChartModule } from '../chart/chart.module';
import { MarketModule } from '../market/market.module';
import { VisualAnalysisService } from './visual-analysis.service';

@Module({
  imports: [MarketModule, ChartModule],
  providers: [VisualAnalysisService],
  exports: [VisualAnalysisService]
})
export class VisualAnalysisModule {}
