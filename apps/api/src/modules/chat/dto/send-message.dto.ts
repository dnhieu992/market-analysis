import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SendMessageDto {
  @ApiProperty({ example: 'Hãy phân tích BTCUSDT khung H1' })
  @IsString()
  @MinLength(1)
  content!: string;

  @ApiPropertyOptional({ example: 'Tab: Vị thế đang mở', description: 'What the user is looking at (the /bitget and /mexc AI chats send the current tab).' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  context?: string;
}
