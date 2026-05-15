import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

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

  @ApiPropertyOptional({ example: 75, description: 'Probability 0-100 that price reaches this zone' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  probability?: number;
}
