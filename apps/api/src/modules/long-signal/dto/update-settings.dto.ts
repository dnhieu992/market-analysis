import { IsOptional, IsNumber, IsInt, IsString, Min, Max, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateLongSignalSettingsDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100000)
  notional?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(20)
  keyValue?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(100)
  atrPeriod?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(50)
  tpPct?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.5)
  @Max(90)
  catastropheStopPct?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  entryHour?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  exitHour?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(125)
  leverage?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  symbols?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  mode?: string;
}
