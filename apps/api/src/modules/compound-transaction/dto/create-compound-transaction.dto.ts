import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateCompoundTransactionDto {
  @ApiProperty({ example: 'BTC' })
  @IsString()
  coinId!: string;

  @ApiProperty({ enum: ['buy', 'sell'], example: 'buy' })
  @IsIn(['buy', 'sell'])
  type!: 'buy' | 'sell';

  @ApiProperty({ example: 50000 })
  @IsNumber()
  @Min(0)
  price!: number;

  @ApiProperty({ example: 0.5 })
  @IsNumber()
  @Min(0)
  amount!: number;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  fee?: number;

  @ApiPropertyOptional({ example: '2024-01-15T10:00:00.000Z' })
  @IsOptional()
  @IsString()
  transactedAt?: string;

  @ApiPropertyOptional({ example: 'DCA buy' })
  @IsOptional()
  @IsString()
  note?: string;
}
