import {
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateSetupDto {
  /** Only BTCUSDT is tracked today; the column and the scan job already take any symbol. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  symbol?: string;

  @IsIn(['LONG', 'SHORT'])
  direction!: 'LONG' | 'SHORT';

  /** The resting limit price — the setup fills when price trades through it. */
  @IsNumber()
  @IsPositive()
  entryPrice!: number;

  @IsNumber()
  @IsPositive()
  stopLoss!: number;

  /** Optional: without it the setup runs until the stop or a manual close. */
  @IsOptional()
  @IsNumber()
  @IsPositive()
  takeProfit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  note?: string;
}
