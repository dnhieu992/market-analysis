import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class ChatMessageDto {
  @IsString()
  @IsIn(['system', 'user', 'assistant'])
  role!: 'system' | 'user' | 'assistant';

  @IsString()
  @IsNotEmpty()
  content!: string;
}
