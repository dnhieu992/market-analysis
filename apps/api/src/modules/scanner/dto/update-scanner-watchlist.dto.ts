import { IsArray, IsIn, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

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

  /** UT Bot Key Value (ATR multiplier). TradingView default = 1, common value = 3. */
  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(20)
  keyValue?: number;

  /** UT Bot ATR Period. TradingView default = 10. */
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(200)
  atrPeriod?: number;
}
