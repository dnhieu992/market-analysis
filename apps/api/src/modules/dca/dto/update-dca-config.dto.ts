import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateDcaConfigDto {
  @ApiPropertyOptional({ example: 5000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  totalBudget?: number;

  @ApiPropertyOptional({ example: 'portfolio-uuid-here' })
  @IsOptional()
  @IsString()
  portfolioId?: string;
}
