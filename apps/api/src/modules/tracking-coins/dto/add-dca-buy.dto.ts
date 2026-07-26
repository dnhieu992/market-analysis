import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class AddDcaBuyDto {
  @IsNumber() @Min(0) price!: number;
  @IsNumber() @Min(0) usd!: number;
  @IsOptional() @IsString() boughtAt?: string;
  // No portfolioId: the position lives in the portfolio configured on the coin (⚙).
}

export class SellDcaDto {
  /** Sell price; omit to use the live price. */
  @IsOptional() @IsNumber() @Min(0) price?: number;
  /** Coin units to sell; omit to sell the whole position. */
  @IsOptional() @IsNumber() @Min(0) amount?: number;
}
