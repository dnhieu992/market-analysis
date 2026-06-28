import { IsNotEmpty, IsString } from 'class-validator';

export class TransferCoinDto {
  /** Portfolio that the coin (all its transactions) will be moved into. */
  @IsString()
  @IsNotEmpty()
  targetPortfolioId!: string;
}
