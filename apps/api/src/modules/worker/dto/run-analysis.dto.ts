import { IsOptional, IsString } from 'class-validator';

export class RunAnalysisDto {
  @IsOptional()
  @IsString()
  symbol?: string;
}
