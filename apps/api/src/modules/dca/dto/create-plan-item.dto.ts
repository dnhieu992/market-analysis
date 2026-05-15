import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreatePlanItemDto {
  @ApiProperty({ enum: ['buy', 'sell'], example: 'buy' })
  @IsIn(['buy', 'sell'])
  type!: 'buy' | 'sell';

  @ApiProperty({ example: 72000 })
  @IsNumber()
  @Min(0)
  targetPrice!: number;

  @ApiProperty({ example: 500, description: 'Buy = USD to spend; Sell = coin amount to sell' })
  @IsNumber()
  @Min(0)
  suggestedAmount!: number;

  @ApiPropertyOptional({ example: 'Strong support zone' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ example: 75, description: 'Probability 0-100 that price reaches this zone' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  probability?: number;
}
