import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListOrdersQueryDto {
  @IsOptional()
  @IsString()
  symbol?: string;

  @IsOptional()
  @IsIn(['open', 'closed'])
  status?: string;

  @IsOptional()
  @IsString()
  broker?: string; // comma-separated list, e.g. "Binance,Bybit"

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}
