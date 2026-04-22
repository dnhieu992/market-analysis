import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator';

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
  amount?: number;

  @ApiPropertyOptional({ example: 50000 })
  @IsOptional()
  @IsNumber()
  price?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber()
  fee?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tradedAt?: string;
}
