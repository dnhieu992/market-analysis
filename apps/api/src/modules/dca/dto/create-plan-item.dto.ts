import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';

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
}
