import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreatePortfolioDto {
  @ApiProperty({ example: 'Main' })
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ example: 'My primary crypto portfolio' })
  @IsOptional()
  @IsString()
  description?: string;
}
