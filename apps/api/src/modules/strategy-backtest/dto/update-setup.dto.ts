import { IsNumber, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

/**
 * Every field optional — the page edits prices only while a setup is still PENDING,
 * but the note stays editable for the whole life of the setup.
 */
export class UpdateSetupDto {
  @IsOptional()
  @IsNumber()
  @IsPositive()
  entryPrice?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  stopLoss?: number;

  /** `null` clears the take profit and lets the setup run to the stop. */
  @IsOptional()
  @IsNumber()
  @IsPositive()
  takeProfit?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  note?: string;
}
