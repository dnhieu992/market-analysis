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
    const logRepository = {
      create: jest.fn().mockResolvedValue({ id: 'log-1' })
    };

    const service = new TelegramService(
      httpClient as never,
      logRepository as never,
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
    expect(logRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisRunId: 'run-1',
        chatId: 'chat-id',
        messageType: 'analysis',
        content: 'Tin nhan phan tich',
        success: true,
        sentAt: expect.any(Date)
      })
    );
  });

  it('does not throw when logging a failed delivery also fails', async () => {
    const httpClient = {
      post: jest.fn().mockRejectedValue(new Error('telegram down'))
    };
    const logRepository = {
      create: jest.fn().mockRejectedValue(new Error('db unavailable'))
    };

    const service = new TelegramService(
      httpClient as never,
      logRepository as never,
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
});
