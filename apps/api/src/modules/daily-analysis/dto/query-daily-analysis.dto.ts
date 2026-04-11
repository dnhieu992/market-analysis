import { ApiPropertyOptional } from '@nestjs/swagger';

export class QueryDailyAnalysisDto {
  @ApiPropertyOptional({ example: 'BTCUSDT' })
  symbol?: string;
}
