import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  symbolsTracking?: string[];

  @ApiPropertyOptional({ example: ['BTCUSDT', 'SUIUSDT'], type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dailySignalWatchlist?: string[];
}
