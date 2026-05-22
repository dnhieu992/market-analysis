import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateScannerWatchlistDto {
  @IsArray()
  @IsString({ each: true })
  symbols!: string[];
}

export class ScanRequestDto {
  @IsArray()
  @IsString({ each: true })
  symbols!: string[];

  @IsOptional()
  @IsIn(['1d', '4h', '1w'])
  timeframe?: '1d' | '4h' | '1w';
}
