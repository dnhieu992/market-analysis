import { ApiProperty } from '@nestjs/swagger';

export class ChatResponseDto {
  @ApiProperty({ example: 'BTC is currently in an uptrend based on EMA analysis.' })
  reply!: string;

  @ApiProperty({ example: 'gpt-4o' })
  model!: string;
}
