import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateCompoundTradeDto {
  @ApiProperty({ example: 'BTC' })
  @IsString()
  coinId!: string;

  @ApiProperty({ enum: ['buy', 'sell'], example: 'buy' })
  @IsString()
  @IsIn(['buy', 'sell'])
  type!: 'buy' | 'sell';

  @ApiProperty({ example: 0.5 })
  @IsNumber()
  amount!: number;

  @ApiProperty({ example: 50000 })
  @IsNumber()
  price!: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber()
  fee?: number;

  @ApiPropertyOptional({ example: 'Long-term hold' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ example: '2024-01-01T00:00:00.000Z' })
  @IsOptional()
  @IsString()
  tradedAt?: string;
}
