import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, Min } from 'class-validator';

export class CreateCompoundTradeDto {
  @ApiProperty({ example: 'BTC' })
  @IsString()
  @IsNotEmpty()
  coinId!: string;

  @ApiProperty({ enum: ['buy', 'sell'], example: 'buy' })
  @IsString()
  @IsIn(['buy', 'sell'])
  type!: 'buy' | 'sell';

  @ApiProperty({ example: 0.5 })
  @IsNumber()
  @IsPositive()
  amount!: number;

  @ApiProperty({ example: 50000 })
  @IsNumber()
  @IsPositive()
  price!: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  fee?: number;

  @ApiPropertyOptional({ example: 'Long-term hold' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ example: '2024-01-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  tradedAt?: string;
}
