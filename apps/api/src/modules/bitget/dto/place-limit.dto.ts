import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNumber, IsString, Matches, Max, Min } from 'class-validator';

/**
 * A resting LIMIT entry placed from the Setup tab: same margin/leverage inputs
 * as a market open, plus the trigger `price` the order waits to fill at.
 */
export class PlaceLimitDto {
  @ApiProperty({ example: 'BTCUSDT', description: 'Bitget symbol to place a limit order on' })
  @IsString()
  @Matches(/^[A-Z0-9]{4,30}$/, { message: 'symbol must be an uppercase Bitget symbol' })
  symbol!: string;

  @ApiProperty({ enum: ['long', 'short'], description: 'Direction of the limit entry' })
  @IsIn(['long', 'short'])
  holdSide!: 'long' | 'short';

  @ApiProperty({ example: 20, description: 'Margin to commit, in USDT (cross)' })
  @IsNumber()
  @Min(0.01)
  marginUsd!: number;

  @ApiProperty({ example: 10, description: 'Leverage (cross margin)' })
  @IsNumber()
  @Min(1)
  @Max(125)
  leverage!: number;

  @ApiProperty({ example: 94000, description: 'Limit price the order waits to fill at' })
  @IsNumber()
  @Min(0)
  price!: number;
}
