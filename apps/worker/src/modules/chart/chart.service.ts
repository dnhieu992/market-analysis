import { Injectable } from '@nestjs/common';

import { renderChart } from './chart-renderer';
import type { ChartInput, ChartOutput } from './chart.types';

@Injectable()
export class ChartService {
  generateChartImage(input: ChartInput): Promise<ChartOutput> {
    return renderChart(input);
  }
}
