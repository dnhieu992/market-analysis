import { IsOptional, IsNumber, IsInt, IsString, IsIn, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateSwingTradingSettingsDto {
  @IsOptional()
  @IsString()
  symbol?: string;

  @IsOptional()
  @IsString()
  timeframe?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  atrPeriod?: number;

  // 0 = "auto": resolve the optimal keyValue per symbol/timeframe (see utbot-kv-table.ts).
  // Any value > 0 is an explicit manual override.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(20)
  keyValue?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(100000)
  riskPerTrade?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(125)
  leverage?: number;

  @IsOptional()
  @IsString()
  @IsIn(['PAPER', 'LIVE'])
  mode?: string;
}
