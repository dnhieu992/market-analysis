import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateTransactionDto {
  @ApiPropertyOptional({ enum: ['buy', 'sell'] })
  @IsOptional()
  @IsIn(['buy', 'sell'])
  type?: 'buy' | 'sell';

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  fee?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  transactedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[] | null;
}
