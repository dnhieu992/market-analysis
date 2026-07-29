import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class UpsertSymbolNoteDto {
  @ApiProperty({ example: 'BTCUSDT', description: 'Bitget symbol the assessment belongs to' })
  @IsString()
  @Matches(/^[A-Z0-9]{4,30}$/, { message: 'symbol must be an uppercase Bitget symbol' })
  symbol!: string;

  @ApiProperty({
    example: 'Cấu trúc HH/HL trên D1, chờ pullback về EMA34.',
    description: 'Markdown assessment. An empty string deletes the note.',
  })
  @IsString()
  note!: string;
}
