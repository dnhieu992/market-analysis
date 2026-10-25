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

/** A tool result that also carries images for Claude to look at (e.g. saved chart snapshots). */
export type ChatToolRichResult = Readonly<{
  kind: 'rich';
  text: string;
  images: ReadonlyArray<Readonly<{ data: string; mimeType: string }>>;
}>;

export function isRichToolResult(value: unknown): value is ChatToolRichResult {
  return typeof value === 'object' && value != null && (value as { kind?: unknown }).kind === 'rich';
}
