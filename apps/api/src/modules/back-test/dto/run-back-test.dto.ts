import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsNumber, IsObject, IsOptional, IsString, Min } from 'class-validator';

const SUPPORTED_TIMEFRAMES = ['15m', 'M30', '1h', '4h', '1d'];

export class RunBackTestDto {
  @ApiProperty({ example: 'ema-crossover' })
  @IsString()
  strategy!: string;

  @ApiProperty({ example: 'BTCUSDT' })
  @IsString()
  symbol!: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  @IsDateString()
  from!: string;

  @ApiProperty({ example: '2024-12-31T00:00:00.000Z' })
  @IsDateString()
  to!: string;

  @ApiPropertyOptional({ enum: SUPPORTED_TIMEFRAMES, example: '4h' })
  @IsOptional()
  @IsString()
  @IsIn(SUPPORTED_TIMEFRAMES)
  timeframe?: string;

  @ApiPropertyOptional({ description: 'Trade notional volume in USD', example: 1000 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  volume?: number;

  @ApiPropertyOptional({
    description: 'Strategy-specific parameters (e.g. tpSteps, entryHourUtc, exitHourUtc for fomo)',
    example: { tpSteps: 700, entryHourUtc: 2, exitHourUtc: 8 }
  })
  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;
}
