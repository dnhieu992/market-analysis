import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class UpsertTradingListNoteDto {
  @ApiProperty({ example: 'BTCUSDT', description: 'USDT-M symbol the assessment belongs to' })
  @IsString()
  @Matches(/^[A-Z0-9]{4,30}$/, { message: 'symbol must be an uppercase USDT-M symbol' })
  symbol!: string;

  @ApiProperty({ example: 'Cấu trúc HH/HL trên D1, chờ pullback về EMA34.', description: 'Markdown. An empty string deletes the note.' })
  @IsString()
  note!: string;
}
