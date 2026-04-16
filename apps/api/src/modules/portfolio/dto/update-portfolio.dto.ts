import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdatePortfolioDto {
  @ApiPropertyOptional({ example: 'Altcoins' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'My altcoin portfolio' })
  @IsOptional()
  @IsString()
  description?: string;
}
