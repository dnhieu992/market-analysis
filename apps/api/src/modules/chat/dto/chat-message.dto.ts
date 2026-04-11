import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class ChatMessageDto {
  @ApiProperty({ enum: ['system', 'user', 'assistant'], example: 'user' })
  @IsString()
  @IsIn(['system', 'user', 'assistant'])
  role!: 'system' | 'user' | 'assistant';

  @ApiProperty({ example: 'What is the current BTC trend?' })
  @IsString()
  @IsNotEmpty()
  content!: string;
}
