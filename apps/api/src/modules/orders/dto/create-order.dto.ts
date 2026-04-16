import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateOrderDto {
  @ApiProperty({ example: 'BTCUSDT' })
  @IsString()
  symbol!: string;

  @ApiProperty({ enum: ['long', 'short'], example: 'long' })
  @IsString()
  @IsIn(['long', 'short'])
  side!: 'long' | 'short';

  @ApiProperty({ example: 84000 })
  @IsNumber()
  entryPrice!: number;

  @ApiPropertyOptional({ example: 82000 })
  @IsOptional()
  @IsNumber()
  stopLoss?: number;

  @ApiPropertyOptional({ example: 88000 })
  @IsOptional()
  @IsNumber()
  takeProfit?: number;

  @ApiPropertyOptional({ example: 0.01 })
  @IsOptional()
  @IsNumber()
  quantity?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber()
  leverage?: number;

  @ApiPropertyOptional({ example: 'Binance' })
  @IsOptional()
  @IsString()
  exchange?: string;

  @ApiPropertyOptional({ example: 'BINGX' })
  @IsOptional()
  @IsString()
  broker?: string;

  @ApiPropertyOptional({ enum: ['market', 'limit'], example: 'market' })
  @IsOptional()
  @IsString()
  @IsIn(['market', 'limit'])
  orderType?: 'market' | 'limit';

  @ApiPropertyOptional({ example: '2024-01-01T00:00:00.000Z' })
  @IsOptional()
  @IsString()
  openedAt?: string;

  @ApiPropertyOptional({ example: 'EMA crossover signal' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ example: 'signal-id-123' })
  @IsOptional()
  @IsString()
  signalId?: string;
}
