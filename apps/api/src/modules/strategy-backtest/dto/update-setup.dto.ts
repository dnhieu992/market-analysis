import {
  ArrayMaxSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Every field optional — the page edits prices only while a setup is still PENDING,
 * but the note and the review stay editable for the whole life of the setup.
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

  /**
   * The post-mortem, markdown. Written after the fact, so it is editable in every
   * status — including a setup that already hit its stop, which is the whole point.
   * An empty string clears it.
   */
  @IsOptional()
  @IsString()
  @MaxLength(50000)
  review?: string;

  /** Screenshots attached to the review, already uploaded via POST /upload/images. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  reviewImages?: string[];
}
