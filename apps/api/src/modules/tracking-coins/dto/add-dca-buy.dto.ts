import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class AddDcaBuyDto {
  @IsNumber() @Min(0) price!: number;
  @IsNumber() @Min(0) usd!: number;
  @IsOptional() @IsString() boughtAt?: string;
  /** Portfolio to mirror this layer into (two-way sync). Omit to skip portfolio sync. */
  @IsOptional() @IsString() portfolioId?: string;
}
