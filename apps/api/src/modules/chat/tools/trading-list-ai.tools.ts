import { Injectable } from '@nestjs/common';

import { BitgetAutoTradeService } from '../../bitget/bitget-auto-trade.service';
import { BitgetSetupService } from '../../bitget/bitget-setup.service';
import { MexcSetupService } from '../../mexc/mexc-setup.service';
import { TradingListService } from '../../trading-list/trading-list.service';
import type { ChatTool } from '../contracts/chat-tool';
import { BitgetAiChatService } from './bitget-ai.tools';
import { MexcAiChatService } from './mexc-ai.tools';

export const TRADING_LIST_AI_SKILL_ID = 'trading-list-ai';

/** "btc" / "BTC" / "btcusdt" → "BTCUSDT". */
function pair(raw: unknown): string {
  const s = String(raw ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!s) return '';
  return s.endsWith('USDT') ? s : `${s}USDT`;
}

/**
 * The /trading-list AI chat (skill `trading-list-ai`): one thread over both accounts.
 * It reuses the /bitget and /mexc read + propose tools as-is (cards still land in
 * `bitget_ai_actions` / `mexc_ai_actions`); what lives here is the shared Setup view
 * (`trading_list_setup`) and the reply context that snapshots both accounts.
 */
@Injectable()
export class TradingListAiChatService {
  constructor(
    private readonly bitgetAi: BitgetAiChatService,
    private readonly mexcAi: MexcAiChatService,
    private readonly tradingList: TradingListService,
    private readonly bitgetSetup: BitgetSetupService,
    private readonly mexcSetup: MexcSetupService,
    private readonly bitgetAuto: BitgetAutoTradeService,
  ) {}

  /** Both accounts' snapshot + recent cards, each under its exchange heading. */
  async buildContext(conversationId: string, pageContext?: string | null): Promise<string> {
    const [bitget, mexc] = await Promise.all([
      this.bitgetAi.buildContext(conversationId, null),
      this.mexcAi.buildContext(conversationId, null),
    ]);
    return [
      pageContext ? `## Trang người dùng đang xem\n${pageContext}` : '',
      `# BITGET\n${bitget}`,
      `# MEXC\n${mexc}`,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  tools(): ChatTool[] {
    return [this.setupTool()] as ChatTool[];
  }

  private setupTool(): ChatTool<{ symbol?: string }, string> {
    return {
      name: 'trading_list_setup',
      description:
        'The /trading-list coin list: 0–5 star priority and the trader\'s written assessment (shared by both exchanges), ' +
        'plus the per-exchange LONG/SHORT leverage + margin config (the default of every card on that exchange), the ' +
        'Bitget auto-trade switch, and whether the coin was added by hand. Pass symbol for one coin with its full note.',
      inputSchema: { type: 'object', properties: { symbol: { type: 'string', description: 'Optional coin — gives the full note' } } },
      execute: async (input) => {
        const sym = input?.symbol ? pair(input.symbol) : null;
        const [prios, notes, watchlist, bgConfigs, mxConfigs, autos] = await Promise.all([
          this.tradingList.listPriorities(),
          this.tradingList.listNotes(),
          this.tradingList.listWatchlist().catch(() => []),
          this.bitgetSetup.list(),
          this.mexcSetup.list(),
          this.bitgetAuto.list().catch(() => []),
        ]);
        const coins = new Set<string>([
          ...prios.map((p) => p.symbol),
          ...watchlist.map((w) => w.symbol),
          ...bgConfigs.map((c) => c.symbol),
          ...mxConfigs.map((c) => c.symbol),
        ]);
        const side = (list: typeof bgConfigs, c: string, holdSide: 'long' | 'short') => {
          const cfg = list.find((x) => x.symbol === c && x.holdSide === holdSide);
          return cfg ? { leverage: cfg.leverage, marginUsd: cfg.marginUsd } : null;
        };
        const rows = [...coins]
          .filter((c) => !sym || c === sym)
          .map((c) => {
            const note = notes.find((n) => n.symbol === c)?.note ?? null;
            const auto = autos.find((a) => a.symbol === c);
            return {
              symbol: c,
              stars: prios.find((p) => p.symbol === c)?.priority ?? 0,
              note: note ? (sym ? note.slice(0, 6000) : note.slice(0, 220)) : null,
              watchlist: watchlist.some((w) => w.symbol === c),
              bitget: {
                long: side(bgConfigs, c, 'long'),
                short: side(bgConfigs, c, 'short'),
                autoTrade: auto ? { enabled: auto.enabled, latestRun: auto.latestRun } : null,
              },
              mexc: { long: side(mxConfigs, c, 'long'), short: side(mxConfigs, c, 'short') },
            };
          })
          .sort((a, b) => b.stars - a.stars);
        return JSON.stringify({ coins: rows });
      },
    };
  }
}
