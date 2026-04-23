import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateOrderDto {
  @ApiPropertyOptional({ example: 'BTCUSDT' })
  @IsOptional()
  @IsString()
  symbol?: string;

  @ApiPropertyOptional({ enum: ['long', 'short'] })
  @IsOptional()
  @IsString()
  @IsIn(['long', 'short'])
  side?: 'long' | 'short';

  @ApiPropertyOptional({ example: 84000 })
  @IsOptional()
  @IsNumber()
  entryPrice?: number;

  @ApiPropertyOptional({ example: 0.01 })
  @IsOptional()
  @IsNumber()
  quantity?: number;

  @ApiPropertyOptional({ example: '2024-01-01T00:00:00.000Z' })
  @IsOptional()
  @IsString()
  openedAt?: string;

  @ApiPropertyOptional({ example: 85000 })
  @IsOptional()
  @IsNumber()
  closePrice?: number;

  @ApiPropertyOptional({ example: 'EMA crossover signal' })
  @IsOptional()
  @IsString()
  note?: string;

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

  @ApiPropertyOptional({ type: [String], example: ['https://res.cloudinary.com/...'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];
}
