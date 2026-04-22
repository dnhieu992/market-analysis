import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsNumber, IsOptional, IsPositive, IsString, Min } from 'class-validator';

export class UpdateCompoundTradeDto {
  @ApiPropertyOptional({ example: 'BTC' })
  @IsOptional()
  @IsString()
  coinId?: string;

  @ApiPropertyOptional({ enum: ['buy', 'sell'] })
  @IsOptional()
  @IsString()
  @IsIn(['buy', 'sell'])
  type?: 'buy' | 'sell';

  @ApiPropertyOptional({ example: 0.5 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;

  @ApiPropertyOptional({ example: 50000 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  price?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  fee?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  tradedAt?: string;
}
