import { Body, Controller, Inject, Post } from '@nestjs/common';

import { ChatService } from './chat.service';
// Runtime class reference is needed for Nest body metatype reflection.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ChatRequestDto } from './dto/chat-request.dto';
import type { ChatResponseDto } from './dto/chat-response.dto';

@Controller('chat')
export class ChatController {
  constructor(
    @Inject(ChatService)
    private readonly chatService: ChatService
  ) {}

  @Post()
  chat(@Body() body: ChatRequestDto): Promise<ChatResponseDto> {
    return this.chatService.chat(body);
  }
}
