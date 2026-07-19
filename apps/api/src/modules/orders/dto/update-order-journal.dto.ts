import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class UpdateOrderJournalDto {
  @ApiProperty({ description: 'Markdown note content' })
  @IsString()
  content!: string;

  @ApiPropertyOptional({ type: [String], description: 'Cloudflare R2 image URLs' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];
}
