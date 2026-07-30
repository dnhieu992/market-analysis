import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsString, Matches } from 'class-validator';

export class UpsertAutoTradeDto {
  @ApiProperty({ example: 'BTCUSDT', description: 'Bitget symbol the auto-entry switch applies to' })
  @IsString()
  @Matches(/^[A-Z0-9]{4,30}$/, { message: 'symbol must be an uppercase Bitget symbol' })
  symbol!: string;

  @ApiProperty({ example: true, description: 'Arm (true) or disarm (false) the 00:00 UTC auto LONG' })
  @IsBoolean()
  enabled!: boolean;
}
