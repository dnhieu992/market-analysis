import { IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class TransferCoinDto {
  /** Portfolio that the coin will be moved into. */
  @IsString()
  @IsNotEmpty()
  targetPortfolioId!: string;

  /**
   * Quantity to move. Omit (or pass the full current holding) to move the whole
   * position along with its transaction history; a smaller number moves only that
   * many units at the source's average cost.
   */
  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;
}
