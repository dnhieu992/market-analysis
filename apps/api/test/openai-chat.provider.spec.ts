import { OpenAiChatProvider } from '../src/modules/chat/providers/openai-chat.provider';

describe('OpenAiChatProvider', () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_MODEL;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.OPENAI_MODEL = 'gpt-4o-mini';
    globalThis.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: 'Hello from OpenAI.'
              }
            }
          ]
        }),
        { status: 200 }
      )
    ) as typeof fetch;
  });

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalApiKey;
    process.env.OPENAI_MODEL = originalModel;
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('forwards messages and returns the first assistant reply', async () => {
    const provider = new OpenAiChatProvider();

    await expect(
      provider.chat([
        {
          role: 'system',
          content: 'Be concise.'
        },
        {
          role: 'user',
          content: 'Hello'
        }
      ])
    ).resolves.toEqual({
      reply: 'Hello from OpenAI.',
      model: 'gpt-4o-mini'
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-openai-key',
          'Content-Type': 'application/json'
        })
      })
    );

    const [, init] = (globalThis.fetch as jest.Mock).mock.calls[0] as [
      RequestInfo | URL,
      RequestInit | undefined
    ];
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      model: string;
      messages: Array<{
        role: string;
        content: string;
      }>;
    };

    expect(body.model).toBe('gpt-4o-mini');
    expect(body.messages).toEqual([
      {
        role: 'system',
        content: 'Be concise.'
      },
      {
        role: 'user',
        content: 'Hello'
      }
    ]);
  });

  it('throws when the OpenAI response does not include content', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), { status: 200 })
    ) as typeof fetch;

    const provider = new OpenAiChatProvider();

    await expect(
      provider.chat([
        {
          role: 'user',
          content: 'Hello'
        }
      ])
    ).rejects.toThrow('OpenAI chat response was empty');
  });
});
