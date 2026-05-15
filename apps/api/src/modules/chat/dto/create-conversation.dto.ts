import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateConversationDto {
  @ApiPropertyOptional({ example: 'Phân tích BTC' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ example: 'price-action' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  skillId?: string;

  @ApiPropertyOptional({ example: 'BTC' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  coinId?: string;

  @ApiPropertyOptional({ example: 'uuid-portfolio-id' })
  @IsOptional()
  @IsString()
  @MaxLength(36)
  portfolioId?: string;
}
