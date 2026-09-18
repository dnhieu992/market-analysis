import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateStrategyHistoryDto {
  @ApiProperty({ example: 'Scan $150M–$500M · 18/09/2026' })
  @IsString()
  @MinLength(1)
  @MaxLength(191)
  title!: string;

  @ApiProperty({ example: 'Top: GRT, IOTA, THETA…' })
  @IsString()
  content!: string;
}
