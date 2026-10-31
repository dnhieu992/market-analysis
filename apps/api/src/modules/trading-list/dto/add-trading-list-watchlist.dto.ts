import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class AddTradingListWatchlistDto {
  @ApiProperty({ example: 'SUIUSDT', description: 'Symbol to track — must list on Bitget or MEXC USDT-M futures' })
  @IsString()
  @Matches(/^[A-Z0-9]{4,30}$/, { message: 'symbol must be an uppercase USDT-M symbol' })
  symbol!: string;
}
