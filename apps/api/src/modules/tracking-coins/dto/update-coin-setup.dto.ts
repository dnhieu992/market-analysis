import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateCoinSetupDto {
  @IsOptional() @IsNumber() @Min(0) swingMaxLoss?: number;
  @IsOptional() @IsNumber() @Min(0) swingMinRR?: number;
  @IsOptional() @IsNumber() @Min(0) daytradeMaxLoss?: number;
  @IsOptional() @IsNumber() @Min(0) daytradeMinRR?: number;
  /** Portfolio DCA layers of this coin sync into; `null` clears it. */
  @IsOptional() @IsString() dcaPortfolioId?: string | null;
}
