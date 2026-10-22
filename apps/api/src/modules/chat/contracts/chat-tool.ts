type ChatToolSchema = Readonly<{
  type: 'object';
  properties: Record<string, unknown>;
  required?: readonly string[];
}>;

/** Where a tool call comes from — lets tools that write state tie it to the conversation. */
export type ChatToolContext = Readonly<{
  conversationId: string;
  skillId?: string;
}>;

export type ChatTool<Input = unknown, Output = unknown> = Readonly<{
  name: string;
  description: string;
  inputSchema: ChatToolSchema;
  execute(input: Input, context?: ChatToolContext): Promise<Output>;
}>;
