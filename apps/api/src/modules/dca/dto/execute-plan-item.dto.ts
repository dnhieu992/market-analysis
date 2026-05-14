import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class ExecutePlanItemDto {
  @ApiProperty({ example: 71500, description: 'Actual execution price' })
  @IsNumber()
  @Min(0)
  executedPrice!: number;

  @ApiProperty({ example: 0.007, description: 'Actual coin amount' })
  @IsNumber()
  @Min(0)
  executedAmount!: number;

  @ApiPropertyOptional({ example: '2026-05-14T10:00:00.000Z', description: 'When the trade actually happened' })
  @IsOptional()
  @IsString()
  executedAt?: string;
}
