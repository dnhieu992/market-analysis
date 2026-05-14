import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdatePlanItemDto {
  @ApiPropertyOptional({ enum: ['buy', 'sell'] })
  @IsOptional()
  @IsIn(['buy', 'sell'])
  type?: 'buy' | 'sell';

  @ApiPropertyOptional({ example: 72000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  targetPrice?: number;

  @ApiPropertyOptional({ example: 500 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  suggestedAmount?: number;

  @ApiPropertyOptional({ example: 'Adjusted zone' })
  @IsOptional()
  @IsString()
  note?: string;
}
