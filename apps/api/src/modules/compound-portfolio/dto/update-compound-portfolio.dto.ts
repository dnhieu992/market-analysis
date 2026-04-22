import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateCompoundPortfolioDto {
  @ApiPropertyOptional({ example: 'BTC Compound Strategy' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'Long-term compounding strategy' })
  @IsOptional()
  @IsString()
  description?: string;
}
