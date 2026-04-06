import { TelegramService } from '../src/modules/telegram/telegram.service';

describe('telegram service', () => {
  it('sends a message and records a success log payload', async () => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        data: {
          ok: true,
          result: {
            message_id: 321
          }
        }
      })
    };
    const service = new TelegramService(
      httpClient as never,
      { botToken: 'bot-token', chatId: 'chat-id' }
    );

    const result = await service.sendAnalysisMessage({
      analysisRunId: 'run-1',
      content: 'Tin nhan phan tich',
      messageType: 'analysis'
    });

    expect(result).toEqual({ success: true, messageId: 321 });
    expect(httpClient.post).toHaveBeenCalledWith(
      '/botbot-token/sendMessage',
      expect.objectContaining({
        chat_id: 'chat-id',
        text: 'Tin nhan phan tich'
      })
    );
  });

  it('does not throw when logging a failed delivery also fails', async () => {
    const httpClient = {
      post: jest.fn().mockRejectedValue(new Error('telegram down'))
    };
    const service = new TelegramService(
      httpClient as never,
      { botToken: 'bot-token', chatId: 'chat-id' }
    );

    await expect(
      service.sendAnalysisMessage({
        analysisRunId: 'run-2',
        content: 'Tin nhan loi',
        messageType: 'analysis'
      })
    ).resolves.toEqual({ success: false });
  });

  it('sends a message to a specific chatId', async () => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        data: { ok: true, result: { message_id: 99 } }
      })
    };
    const service = new TelegramService(
      httpClient as never,
      { botToken: 'bot-token', chatId: 'default-chat' }
    );

    const result = await service.sendToChat('specific-chat-123', 'Hello from polling');

    expect(result).toEqual({ success: true, messageId: 99 });
    expect(httpClient.post).toHaveBeenCalledWith(
      '/botbot-token/sendMessage',
      expect.objectContaining({
        chat_id: 'specific-chat-123',
        text: 'Hello from polling'
      })
    );
  });
});
