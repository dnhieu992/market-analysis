import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

const SUPPORTED_TIMEFRAMES = ['15m', '1h', '4h', '1d'];

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
}
