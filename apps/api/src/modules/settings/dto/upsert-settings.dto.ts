import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsString } from 'class-validator';

export class UpsertSettingsDto {
  @ApiProperty({ example: 'My Watchlist' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: ['BTCUSDT', 'ETHUSDT'], type: [String] })
  @IsArray()
  @IsString({ each: true })
  trackingSymbols!: string[];
}
