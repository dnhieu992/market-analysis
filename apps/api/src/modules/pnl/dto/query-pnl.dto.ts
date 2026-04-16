import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class QueryPnlDto {
  @ApiPropertyOptional({ example: '2024-01-01', description: 'Start date (inclusive)' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ example: '2024-12-31', description: 'End date (inclusive)' })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({ example: 'BTC', description: 'Filter by coin. Omit for portfolio aggregate.' })
  @IsOptional()
  @IsString()
  coinId?: string;
}
