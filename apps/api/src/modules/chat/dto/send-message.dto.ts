import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class SendMessageDto {
  @ApiProperty({ example: 'Hãy phân tích BTCUSDT khung H1' })
  @IsString()
  @MinLength(1)
  content!: string;
}
