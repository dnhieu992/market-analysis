import { Injectable } from '@nestjs/common';

import { BitgetAutoTradeService } from '../../bitget/bitget-auto-trade.service';
import { BitgetSetupService } from '../../bitget/bitget-setup.service';
import { MexcSetupService } from '../../mexc/mexc-setup.service';
import { TradeEntryService } from '../../trade-entries/trade-entry.service';
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
    private readonly tradeEntries: TradeEntryService,
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
    return [this.setupTool(), this.entryCheckTool(), this.strategyReviewTool()] as ChatTool[];
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

  private entryCheckTool(): ChatTool<{ symbols?: string[] | string; side?: string; exchange?: string }, string> {
    return {
      name: 'entry_check',
      description:
        'Live check of which ENTRY STRATEGIES coins match right now, computed by the app with the same formulas as the stored ' +
        'trade entries (QQE D1/H4/1h with the app\'s QQE params, RSI(14) D1/H4/1h, EMA34/89 D1, distance to EMA89 D1, 24h/7d/30d ' +
        'change, BTC context). For each coin returns the snapshot and a pass/fail checklist per strategy (qqe-pullback-swing A/B, ' +
        'qqe-rsi1h-scalp strong/normal, hedge-short). Prefer this over computing RSI/EMA by hand from get_klines. Up to 25 coins per call.',
      inputSchema: {
        type: 'object',
        properties: {
          symbols: { type: 'array', items: { type: 'string' }, description: 'Coins, e.g. ["SOL","LINK"]' },
          side: { type: 'string', description: '"long" (default) or "short"' },
          exchange: { type: 'string', description: '"bitget" (default) or "mexc" — used for the hedge-short check (opposite long on that exchange)' },
        },
        required: ['symbols'],
      },
      execute: async (input) => {
        const raw = Array.isArray(input?.symbols) ? input.symbols : String(input?.symbols ?? '').split(/[,\s]+/);
        const symbols = [...new Set(raw.map(pair).filter(Boolean))].slice(0, 25);
        if (!symbols.length) return 'Thiếu symbols.';
        const side = input?.side === 'short' ? 'short' : 'long';
        const exchange = input?.exchange === 'mexc' ? 'mexc' : 'bitget';
        const out = [];
        for (const symbol of symbols) {
          const r = await this.tradeEntries.entryCheck({ symbol, side, exchange }).catch((e: Error) => ({ symbol, error: e.message }));
          if ('error' in r) {
            out.push(r);
            continue;
          }
          const f = r.features;
          out.push({
            symbol,
            matched: r.matched.map((m) => `${m.key} ${m.grade}`),
            snapshot: f
              ? {
                  price: f.price,
                  qqeD1: f.qqeD1,
                  qqeD1BarsSinceCross: f.qqeD1BarsSinceCross,
                  qqeH4: f.qqeH4,
                  qqe1h: f.qqe1h,
                  rsiD1: f.rsiD1,
                  rsiH4: f.rsiH4,
                  rsi1h: f.rsi1h,
                  distEma89D1Pct: f.distEma89D1Pct,
                  distEma34D1Pct: f.distEma34D1Pct,
                  ema89D1: f.ema89D1,
                  chg24hPct: f.chg24hPct,
                  chg7dPct: f.chg7dPct,
                  chg30dPct: f.chg30dPct,
                  btc: f.btc,
                }
              : 'không có nến Binance spot cho coin này',
            strategies: r.strategies.map((s) => ({
              key: s.key,
              grade: s.grade,
              failed: s.checks.filter((c) => c.pass === false).map((c) => `${c.label} (${c.value})`),
              unknown: s.checks.filter((c) => c.pass == null).map((c) => c.label),
            })),
          });
        }
        return JSON.stringify({ side, exchange, coins: out });
      },
    };
  }

  private strategyReviewTool(): ChatTool<{ days?: number; exchange?: string }, string> {
    return {
      name: 'strategy_review',
      description:
        'Results of the trader\'s REAL trades grouped by entry strategy, from trade_entries joined with the Bitget/MEXC trade ' +
        'history: by the strategy DECLARED on the entry (AI card / Setup tab) and by the rules the entry actually MATCHED at entry ' +
        'time (recomputed for old trades too). Per group: trades, closed, open, win rate, realized net PnL, median hold days, ' +
        'trades open > 7 days, trades that reached ROE ≤ −100%. Use it to judge which strategy works and to compare against discretionary entries.',
      inputSchema: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Look-back window in days (default 90)' },
          exchange: { type: 'string', description: '"bitget", "mexc" or omit for both' },
        },
      },
      execute: async (input) => {
        const exchange = input?.exchange === 'bitget' || input?.exchange === 'mexc' ? input.exchange : undefined;
        const res = await this.tradeEntries.strategyReview({ days: Number(input?.days) || undefined, exchange });
        return JSON.stringify(res);
      },
    };
  }
}
