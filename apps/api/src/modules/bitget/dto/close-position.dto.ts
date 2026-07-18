import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Matches } from 'class-validator';

export class ClosePositionDto {
  @ApiProperty({ example: 'BTCUSDT', description: 'Bitget symbol of the position to close' })
  @IsString()
  @Matches(/^[A-Z0-9]{4,30}$/, { message: 'symbol must be an uppercase Bitget symbol' })
  symbol!: string;

  @ApiProperty({ enum: ['long', 'short'], description: 'Side of the position to close' })
  @IsIn(['long', 'short'])
  holdSide!: 'long' | 'short';
}
