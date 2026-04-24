import { Injectable } from '@nestjs/common';

import { ChatToolRegistry } from '../contracts/chat-tool-registry';
import type { ChatTool } from '../contracts/chat-tool';
import { get24hTickerTool, getKlinesTool, getTickerPriceTool } from './binance.tool';

@Injectable()
export class TradingChatToolRegistry extends ChatToolRegistry {
  private readonly tools: Map<string, ChatTool> = new Map([
    [getKlinesTool.name,      getKlinesTool],
    [getTickerPriceTool.name, getTickerPriceTool],
    [get24hTickerTool.name,   get24hTickerTool]
  ]);

  listTools(): readonly ChatTool[] {
    return Array.from(this.tools.values());
  }

  getTool(name: string): ChatTool | undefined {
    return this.tools.get(name);
  }
}
