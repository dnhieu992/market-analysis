import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsNumber,
  Matches,
  Max,
  Min,
} from 'class-validator';

/**
 * Apply one leverage/margin config to many coins at once. The write covers the
 * cartesian product `symbols × holdSides` and OVERWRITES whatever those pairs
 * had before — sides that are not listed are left untouched.
 */
export class BulkUpsertSetupConfigDto {
  @ApiProperty({ example: ['BTCUSDT', 'ETHUSDT'], description: 'Symbols to configure' })
  @IsArray()
  @ArrayNotEmpty({ message: 'Chọn ít nhất 1 coin.' })
  @Matches(/^[A-Z0-9]{4,30}$/, { each: true, message: 'symbols must be uppercase Bitget symbols' })
  symbols!: string[];

  @ApiProperty({ example: ['long', 'short'], description: 'Sides to configure for every symbol' })
  @IsArray()
  @ArrayNotEmpty({ message: 'Chọn ít nhất 1 hướng (Long/Short).' })
  @IsIn(['long', 'short'], { each: true })
  holdSides!: Array<'long' | 'short'>;

  @ApiProperty({ example: 10, description: 'Leverage (cross margin), applied to every pair' })
  @IsNumber()
  @Min(1)
  @Max(125)
  leverage!: number;

  @ApiProperty({ example: 20, description: 'Margin in USDT, applied to every pair' })
  @IsNumber()
  @Min(0)
  marginUsd!: number;
}
