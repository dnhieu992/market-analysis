import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class SaveTradeChartDto {
  @ApiProperty({ example: 'BTCUSDT-long-2026-07-20T10:00:00.000Z', description: 'Trade session key' })
  @IsString()
  tradeKey!: string;

  @ApiProperty({ example: 'BTCUSDT' })
  @IsString()
  @Matches(/^[A-Z0-9]{4,30}$/, { message: 'symbol must be an uppercase Bitget symbol' })
  symbol!: string;

  @ApiProperty({ enum: ['M30', '1h', '4h', '1d'] })
  @IsIn(['M30', '1h', '4h', '1d'])
  timeframe!: string;

  @ApiProperty({ enum: ['long', 'short'] })
  @IsIn(['long', 'short'])
  holdSide!: 'long' | 'short';

  @ApiProperty({ example: 64555.9 })
  @IsNumber()
  entryPrice!: number;

  @ApiProperty({ example: 64980.1 })
  @IsNumber()
  closePrice!: number;

  @ApiProperty({ example: 12.34, description: 'Realized net PnL (USDT)' })
  @IsNumber()
  pnlUsd!: number;

  @ApiProperty({ example: 1775534400000, description: 'Open time (ms epoch)' })
  @IsNumber()
  openedAt!: number;

  @ApiProperty({ example: 1775620800000, description: 'Close time (ms epoch)' })
  @IsNumber()
  closedAt!: number;

  @ApiPropertyOptional({ example: 'Chốt lời sớm, sợ đảo chiều', description: 'Optional note' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
