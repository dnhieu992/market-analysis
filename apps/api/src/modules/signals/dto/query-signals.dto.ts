import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class QuerySignalsDto {
  @ApiPropertyOptional({ example: 'BTCUSDT' })
  @IsOptional()
  @IsString()
  symbol?: string;

  @ApiPropertyOptional({ enum: ['4h'], example: '4h' })
  @IsOptional()
  @IsString()
  @IsIn(['4h'])
  timeframe?: string;
}
