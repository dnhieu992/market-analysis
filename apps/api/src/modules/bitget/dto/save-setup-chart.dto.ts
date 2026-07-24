import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class SaveSetupChartDto {
  @ApiProperty({ example: 'BTCUSDT' })
  @IsString()
  @Matches(/^[A-Z0-9]{4,30}$/, { message: 'symbol must be an uppercase Bitget symbol' })
  symbol!: string;

  @ApiProperty({ enum: ['15m', 'M30', '1h', '4h', '1d'] })
  @IsIn(['15m', 'M30', '1h', '4h', '1d'])
  timeframe!: string;

  @ApiPropertyOptional({ example: 'Vào theo QQE long + engulfing', description: 'Optional note' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
