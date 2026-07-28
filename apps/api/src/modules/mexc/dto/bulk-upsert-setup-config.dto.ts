import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsNumber,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/** Leverage + margin for ONE side, applied to every symbol in the batch. */
export class BulkSetupSideDto {
  @ApiProperty({ enum: ['long', 'short'], description: 'Side these values configure' })
  @IsIn(['long', 'short'])
  holdSide!: 'long' | 'short';

  @ApiProperty({ example: 10, description: 'Leverage (cross margin) for this side' })
  @IsNumber()
  @Min(1)
  @Max(125)
  leverage!: number;

  @ApiProperty({ example: 20, description: 'Margin in USDT for this side' })
  @IsNumber()
  @Min(0)
  marginUsd!: number;
}

/**
 * Apply per-side configs to many coins at once. The write covers every
 * `symbols × sides[].holdSide` pair and OVERWRITES what those pairs had before;
 * a side that is absent from `sides` is left untouched. Long and short carry
 * their own leverage/margin, so one save can set both at different sizes.
 */
export class BulkUpsertSetupConfigDto {
  @ApiProperty({ example: ['BTCUSDT', 'ETHUSDT'], description: 'Symbols to configure' })
  @IsArray()
  @ArrayNotEmpty({ message: 'Chọn ít nhất 1 coin.' })
  @Matches(/^[A-Z0-9]{4,30}$/, { each: true, message: 'symbols must be uppercase MEXC symbols' })
  symbols!: string[];

  @ApiProperty({
    type: [BulkSetupSideDto],
    description: 'Per-side leverage/margin — at most one entry per side',
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'Chọn ít nhất 1 hướng (Long/Short).' })
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => BulkSetupSideDto)
  sides!: BulkSetupSideDto[];
}
