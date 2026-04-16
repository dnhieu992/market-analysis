import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class UpdateStrategyDto {
  @ApiPropertyOptional({ example: 'EMA Crossover' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'Strategy content / description' })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiPropertyOptional({ example: ['https://example.com/image.png'], type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageReference?: string[];

  @ApiPropertyOptional({ example: '1.1.0' })
  @IsOptional()
  @IsString()
  version?: string;
}
