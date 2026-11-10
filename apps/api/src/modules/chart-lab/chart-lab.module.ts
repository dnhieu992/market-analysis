import { Module } from '@nestjs/common';

import { ChartLabController } from './chart-lab.controller';
import { ChartLabService } from './chart-lab.service';

/** /chart-lab: chart library — saved as the user typed it, scored from Binance. Claude only via Analyze (chat module). */
@Module({
  controllers: [ChartLabController],
  providers: [ChartLabService],
  exports: [ChartLabService],
})
export class ChartLabModule {}
