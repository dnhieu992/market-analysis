type ChatToolSchema = Readonly<{
  type: 'object';
  properties: Record<string, unknown>;
  required?: readonly string[];
}>;

export type ChatTool<Input = unknown, Output = unknown> = Readonly<{
  name: string;
  description: string;
  inputSchema: ChatToolSchema;
  execute(input: Input): Promise<Output>;
}>;
