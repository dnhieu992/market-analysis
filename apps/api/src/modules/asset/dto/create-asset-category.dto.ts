import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class CreateAssetCategoryDto {
  /** Stable slug, e.g. "binance". Lowercased and validated in the service. */
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  key!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  label!: string;

  /** Position on the page. Defaults to last when omitted. */
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
