import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class AddWatchlistSymbolDto {
  @ApiProperty({ example: 'SUIUSDT', description: 'OKX symbol to track in the Setup tab' })
  @IsString()
  @Matches(/^[A-Z0-9]{4,30}$/, { message: 'symbol must be an uppercase OKX symbol' })
  symbol!: string;
}
