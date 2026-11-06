import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateShortSkillDto {
  @ApiProperty({ description: 'Full new content of the analysis skill (Markdown)' })
  @IsString()
  @MinLength(20)
  @MaxLength(60000)
  content!: string;

  @ApiPropertyOptional({ example: 'Thêm điều kiện RSI H4 > 70' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
