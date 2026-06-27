import { IsBoolean, IsNumber, IsOptional, IsPositive, Min } from 'class-validator';

export class UpdateDcaLadderSettingsDto {
  @IsOptional() @IsNumber() @IsPositive() startCapital?: number;
  @IsOptional() @IsNumber() @IsPositive() firstTierPct?: number;
  @IsOptional() @IsNumber() @Min(1) numTiers?: number;
  @IsOptional() @IsNumber() @IsPositive() stepPct?: number;
  @IsOptional() @IsNumber() @IsPositive() tpPct?: number;
  @IsOptional() @IsNumber() @Min(0) feePct?: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
}
