import { IsIn, IsOptional, IsString } from 'class-validator';

export class QueryAnalysisRunsDto {
  @IsOptional()
  @IsString()
  symbol?: string;

  @IsOptional()
  @IsString()
  @IsIn(['4h'])
  timeframe?: string;
}
