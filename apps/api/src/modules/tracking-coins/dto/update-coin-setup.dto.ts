import { IsNumber, IsOptional, Min } from 'class-validator';

export class UpdateCoinSetupDto {
  @IsOptional() @IsNumber() @Min(0) swingMaxLoss?: number;
  @IsOptional() @IsNumber() @Min(0) swingMinRR?: number;
  @IsOptional() @IsNumber() @Min(0) daytradeMaxLoss?: number;
  @IsOptional() @IsNumber() @Min(0) daytradeMinRR?: number;
  @IsOptional() @IsNumber() @Min(1) dcaMaxLayers?: number;
}
