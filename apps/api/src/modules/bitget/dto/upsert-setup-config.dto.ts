import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNumber, IsString, Matches, Max, Min } from 'class-validator';

export class UpsertSetupConfigDto {
  @ApiProperty({ example: 'BTCUSDT', description: 'Bitget symbol the config applies to' })
  @IsString()
  @Matches(/^[A-Z0-9]{4,30}$/, { message: 'symbol must be an uppercase Bitget symbol' })
  symbol!: string;

  @ApiProperty({ enum: ['long', 'short'], description: 'Side this config configures' })
  @IsIn(['long', 'short'])
  holdSide!: 'long' | 'short';

  @ApiProperty({ example: 10, description: 'Leverage (cross margin)' })
  @IsNumber()
  @Min(1)
  @Max(125)
  leverage!: number;

  @ApiProperty({ example: 20, description: 'Margin to commit, in USDT (0 = not configured)' })
  @IsNumber()
  @Min(0)
  marginUsd!: number;
}
