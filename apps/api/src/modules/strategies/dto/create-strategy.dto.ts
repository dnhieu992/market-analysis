import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class CreateStrategyDto {
  @ApiProperty({ example: 'EMA Crossover' })
  @IsString()
  name!: string;

  @ApiProperty({ example: 'Strategy content / description' })
  @IsString()
  content!: string;

  @ApiPropertyOptional({ example: ['https://example.com/image.png'], type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageReference?: string[];

  @ApiProperty({ example: '1.0.0' })
  @IsString()
  version!: string;
}
