import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString, Matches, Min } from 'class-validator';

/**
 * Position-level TP/SL for one open position. Both prices are always sent by the
 * dialog: a `null` means "clear this trigger on the exchange", not "leave as is".
 */
export class SetTpslDto {
  @ApiProperty({ example: 'BTCUSDT', description: 'Bitget symbol of the open position' })
  @IsString()
  @Matches(/^[A-Z0-9]{4,30}$/, { message: 'symbol must be an uppercase Bitget symbol' })
  symbol!: string;

  @ApiProperty({ enum: ['long', 'short'], description: 'Side of the open position' })
  @IsIn(['long', 'short'])
  holdSide!: 'long' | 'short';

  @ApiPropertyOptional({ example: 70000, nullable: true, description: 'Take-profit trigger price, null to clear' })
  @IsOptional() // null / absent = clear this trigger
  @IsNumber()
  @Min(0)
  takeProfitPrice?: number | null;

  @ApiPropertyOptional({ example: 60000, nullable: true, description: 'Stop-loss trigger price, null to clear' })
  @IsOptional() // null / absent = clear this trigger
  @IsNumber()
  @Min(0)
  stopLossPrice?: number | null;
}
