import { Injectable } from '@nestjs/common';

import { ChatToolRegistry } from '../contracts/chat-tool-registry';
import type { ChatTool } from '../contracts/chat-tool';
import { get24hTickerTool, getKlinesTool, getTickerPriceTool } from './binance.tool';
import { analyzeMarketStructureTool } from './market-structure.tool';
import { getScalpChartDataTool } from './scalp-chart.tool';
import { createProposeTradeSetupTool } from './trade-setup.tool';
import { proposeSwingSetupTool } from './swing-setup.tool';
import { getTrackingCoinsTool } from './tracking-coins.tool';
import { BitgetAiChatService } from './bitget-ai.tools';

@Injectable()
export class TradingChatToolRegistry extends ChatToolRegistry {
  private readonly tools: Map<string, ChatTool> = new Map([
    [getKlinesTool.name,               getKlinesTool],
    [getTickerPriceTool.name,          getTickerPriceTool],
    [get24hTickerTool.name,            get24hTickerTool],
    [analyzeMarketStructureTool.name,  analyzeMarketStructureTool],
    [getScalpChartDataTool.name,       getScalpChartDataTool],
    [getTrackingCoinsTool.name,        getTrackingCoinsTool],
    [proposeSwingSetupTool.name,       proposeSwingSetupTool],
    ['propose_trade_setup',            createProposeTradeSetupTool()]
  ]);

  constructor(bitgetAi: BitgetAiChatService) {
    super();
    // The /bitget AI chat tools need the live Bitget services, so they come from DI.
    for (const tool of bitgetAi.tools()) this.tools.set(tool.name, tool);
  }

  listTools(): readonly ChatTool[] {
    return Array.from(this.tools.values());
  }

  getTool(name: string): ChatTool | undefined {
    return this.tools.get(name);
  }
}
