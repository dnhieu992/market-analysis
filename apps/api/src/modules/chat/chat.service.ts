import { BadRequestException, Inject, Injectable, InternalServerErrorException } from '@nestjs/common';

import type { ChatMessage } from './contracts/chat-message';
import { ChatProvider } from './contracts/chat-provider';
import { ChatToolRegistry } from './contracts/chat-tool-registry';
import type { ChatRequestDto } from './dto/chat-request.dto';
import type { ChatResponseDto } from './dto/chat-response.dto';

@Injectable()
export class ChatService {
  constructor(
    @Inject(ChatProvider)
    private readonly chatProvider: ChatProvider,
    @Inject(ChatToolRegistry)
    private readonly chatToolRegistry: ChatToolRegistry
  ) {}

  async chat(input: ChatRequestDto): Promise<ChatResponseDto> {
    const messages = this.normalizeMessages(input.messages);

    try {
      void this.chatToolRegistry;

      return await this.chatProvider.chat(messages);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException('Failed to generate chat response');
    }
  }

  private normalizeMessages(messages: ChatRequestDto['messages']): readonly ChatMessage[] {
    if (messages.length === 0) {
      throw new BadRequestException('messages must not be empty');
    }

    return messages.map((message) => {
      const content = message.content.trim();

      if (!content) {
        throw new BadRequestException('message content must not be empty');
      }

      return {
        role: message.role,
        content
      };
    });
  }
}
