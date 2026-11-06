import { Injectable } from '@nestjs/common';

import { ChatToolRegistry } from '../contracts/chat-tool-registry';
import type { ChatTool } from '../contracts/chat-tool';
import { get24hTickerTool, getKlinesTool, getTickerPriceTool } from './binance.tool';
import { analyzeMarketStructureTool } from './market-structure.tool';
import { getScalpChartDataTool } from './scalp-chart.tool';
import { createProposeTradeSetupTool } from './trade-setup.tool';
import { proposeSwingSetupTool } from './swing-setup.tool';
import { getTrackingCoinsTool } from './tracking-coins.tool';
import { scanJunkShortsTool } from './junk-short-scan.tool';
import { BitgetAiChatService } from './bitget-ai.tools';
import { MexcAiChatService } from './mexc-ai.tools';
import { TradingListAiChatService } from './trading-list-ai.tools';
import { OkxShortAiChatService } from './okx-short-ai.tools';

@Injectable()
export class TradingChatToolRegistry extends ChatToolRegistry {
  private readonly tools: Map<string, ChatTool> = new Map<string, ChatTool>([
    [getKlinesTool.name,               getKlinesTool],
    [getTickerPriceTool.name,          getTickerPriceTool],
    [get24hTickerTool.name,            get24hTickerTool],
    [analyzeMarketStructureTool.name,  analyzeMarketStructureTool],
    [getScalpChartDataTool.name,       getScalpChartDataTool],
    [getTrackingCoinsTool.name,        getTrackingCoinsTool],
    [scanJunkShortsTool.name,          scanJunkShortsTool],
    [proposeSwingSetupTool.name,       proposeSwingSetupTool],
    ['propose_trade_setup',            createProposeTradeSetupTool()]
  ]);

  constructor(bitgetAi: BitgetAiChatService, mexcAi: MexcAiChatService, tradingListAi: TradingListAiChatService, okxShortAi: OkxShortAiChatService) {
    super();
    // The /bitget, /mexc, /trading-list and /trades (OKX short) AI chat tools need the live exchange services, so they come from DI.
    for (const tool of [...bitgetAi.tools(), ...mexcAi.tools(), ...tradingListAi.tools(), ...okxShortAi.tools()]) this.tools.set(tool.name, tool);
  }

  listTools(): readonly ChatTool[] {
    return Array.from(this.tools.values());
  }

  getTool(name: string): ChatTool | undefined {
    return this.tools.get(name);
  }
}
