import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNumber, IsString, Matches, Max, Min } from 'class-validator';

export class OpenPositionDto {
  @ApiProperty({ example: 'BTCUSDT', description: 'Bitget symbol to open a position on' })
  @IsString()
  @Matches(/^[A-Z0-9]{4,30}$/, { message: 'symbol must be an uppercase Bitget symbol' })
  symbol!: string;

  @ApiProperty({ enum: ['long', 'short'], description: 'Direction of the position to open' })
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
}
