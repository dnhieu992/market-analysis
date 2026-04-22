import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCompoundPortfolioDto {
  @ApiProperty({ example: 'BTC Compound Strategy' })
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ example: 'Long-term compounding strategy' })
  @IsOptional()
  @IsString()
  description?: string;
}
