import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

const SUPPORTED_TIMEFRAMES = ['15m', '1h', '4h', '1d'];

export class RunBackTestDto {
  @IsString()
  strategy!: string;

  @IsString()
  symbol!: string;

  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsOptional()
  @IsString()
  @IsIn(SUPPORTED_TIMEFRAMES)
  timeframe?: string;
}
