import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, Max, Min } from 'class-validator';

/**
 * The user's edits from the AI action confirm dialog. Anything left out keeps the
 * value Claude proposed; `takeProfitPrice: null` means "no TP".
 */
export class ExecuteAiActionDto {
  @ApiPropertyOptional({ enum: ['MARKET', 'LIMIT'] })
  @IsOptional()
  @IsIn(['MARKET', 'LIMIT'])
  orderType?: 'MARKET' | 'LIMIT';

  @ApiPropertyOptional({ example: 62000, description: 'Limit price (LIMIT orders only)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({ example: 1, description: 'Margin in USDT' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  marginUsd?: number;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(125)
  leverage?: number;

  @ApiPropertyOptional({ example: 64000, nullable: true, description: 'Take-profit trigger, null = none' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  takeProfitPrice?: number | null;

  @ApiPropertyOptional({ example: 50, description: 'CLOSE only: % of the position to close' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  closePct?: number;
}
