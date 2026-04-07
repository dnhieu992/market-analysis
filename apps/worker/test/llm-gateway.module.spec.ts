describe('llm gateway module', () => {
  const originalProvider = process.env.LLM_PROVIDER;
  const originalClaudeModel = process.env.CLAUDE_MODEL;

  afterEach(() => {
    if (originalProvider === undefined) {
      delete process.env.LLM_PROVIDER;
    } else {
      process.env.LLM_PROVIDER = originalProvider;
    }

    if (originalClaudeModel === undefined) {
      delete process.env.CLAUDE_MODEL;
    } else {
      process.env.CLAUDE_MODEL = originalClaudeModel;
    }

    jest.resetModules();
  });

  it('defaults to Claude provider and Sonnet model', async () => {
    delete process.env.LLM_PROVIDER;
    delete process.env.CLAUDE_MODEL;

    const { resolveLlmGatewayConfig } = await import('../src/modules/llm/llm-gateway.module');

    expect(resolveLlmGatewayConfig()).toEqual({
      provider: 'claude',
      claudeModelVariant: 'sonnet'
    });
  });

  it('throws for unsupported providers', async () => {
    process.env.LLM_PROVIDER = 'unsupported';

    const { resolveLlmGatewayConfig } = await import('../src/modules/llm/llm-gateway.module');

    expect(() => resolveLlmGatewayConfig()).toThrow('Unsupported LLM provider: unsupported');
  });

  it('accepts a raw Claude model id from env', async () => {
    process.env.LLM_PROVIDER = 'claude';
    process.env.CLAUDE_MODEL = 'claude-sonnet-4-20250514';

    const { resolveLlmGatewayConfig } = await import('../src/modules/llm/llm-gateway.module');

    expect(resolveLlmGatewayConfig()).toEqual({
      provider: 'claude',
      claudeModelVariant: 'claude-sonnet-4-20250514'
    });
  });
});
