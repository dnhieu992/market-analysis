import { BadRequestException } from '@nestjs/common';

import { ChatService } from '../src/modules/chat/chat.service';
import type { ChatProvider } from '../src/modules/chat/contracts/chat-provider';
import type { ChatToolRegistry } from '../src/modules/chat/contracts/chat-tool-registry';

describe('chat service orchestration', () => {
  it('normalizes messages and returns the provider reply', async () => {
    const chatProvider = {
      chat: jest.fn().mockResolvedValue({
        reply: 'Hello there.',
        model: 'gpt-4o-mini'
      })
    } as unknown as jest.Mocked<ChatProvider>;
    const chatToolRegistry = {
      listTools: jest.fn().mockReturnValue([]),
      getTool: jest.fn()
    } as unknown as jest.Mocked<ChatToolRegistry>;
    const service = new ChatService(chatProvider, chatToolRegistry);

    await expect(
      service.chat({
        messages: [
          {
            role: 'user',
            content: '  Hello  '
          }
        ]
      })
    ).resolves.toEqual({
      reply: 'Hello there.',
      model: 'gpt-4o-mini'
    });

    expect(chatProvider.chat).toHaveBeenCalledWith([
      {
        role: 'user',
        content: 'Hello'
      }
    ]);
    expect(chatToolRegistry.listTools).not.toHaveBeenCalled();
    expect(chatToolRegistry.getTool).not.toHaveBeenCalled();
  });

  it('rejects an empty message list before calling the provider', async () => {
    const chatProvider = {
      chat: jest.fn()
    } as unknown as jest.Mocked<ChatProvider>;
    const chatToolRegistry = {
      listTools: jest.fn().mockReturnValue([]),
      getTool: jest.fn()
    } as unknown as jest.Mocked<ChatToolRegistry>;
    const service = new ChatService(chatProvider, chatToolRegistry);

    await expect(service.chat({ messages: [] })).rejects.toBeInstanceOf(BadRequestException);

    expect(chatProvider.chat).not.toHaveBeenCalled();
  });

  it('wraps provider failures in a stable backend error', async () => {
    const chatProvider = {
      chat: jest.fn().mockRejectedValue(new Error('openai unavailable'))
    } as unknown as jest.Mocked<ChatProvider>;
    const chatToolRegistry = {
      listTools: jest.fn().mockReturnValue([]),
      getTool: jest.fn()
    } as unknown as jest.Mocked<ChatToolRegistry>;
    const service = new ChatService(chatProvider, chatToolRegistry);

    await expect(
      service.chat({
        messages: [
          {
            role: 'user',
            content: 'Hello'
          }
        ]
      })
    ).rejects.toMatchObject({
      message: 'Failed to generate chat response'
    });

    expect(chatProvider.chat).toHaveBeenCalledTimes(1);
  });
});
