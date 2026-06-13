import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateFeedbackDto {
  @ApiPropertyOptional({ example: 4, description: 'Score from 1 to 5 (optional)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  score?: number;

  @ApiPropertyOptional({ example: 'Plan này chính xác, entry tốt' })
  @IsOptional()
  @IsString()
  note?: string;
}
