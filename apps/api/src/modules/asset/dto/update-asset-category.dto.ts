import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

/** `key` is intentionally not updatable — it is the stable handle other code looks up. */
export class UpdateAssetCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  label?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
