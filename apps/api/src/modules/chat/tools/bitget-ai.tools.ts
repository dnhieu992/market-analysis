import { Injectable, Logger } from '@nestjs/common';
import { averageEntry, capitalSharePct, favourableMovePct, sizeFromMargin } from '@app/core';
import { createBitgetAiActionRepository } from '@app/db';

import { BitgetAutoTradeService } from '../../bitget/bitget-auto-trade.service';
import { BitgetJournalService } from '../../bitget/bitget-journal.service';
import { BitgetService, type BitgetPosition } from '../../bitget/bitget.service';
import { BitgetSetupService } from '../../bitget/bitget-setup.service';
import { BitgetSetupChartService } from '../../bitget/bitget-setup-chart.service';
import type { ChatTool, ChatToolRichResult } from '../contracts/chat-tool';

export const BITGET_AI_SKILL_ID = 'bitget-ai';

const ACTION_TYPES = ['OPEN', 'DCA', 'SET_TP', 'CLOSE', 'CANCEL'] as const;
type ActionType = (typeof ACTION_TYPES)[number];

const STATUS_VI: Record<string, string> = {
  PROPOSED: 'đề xuất, chờ user',
  EXECUTED: 'đã thực hiện',
  FAILED: 'lỗi',
  DISMISSED: 'user bỏ qua',
};

/** "btc" / "BTC" / "btcusdt" → "BTCUSDT". */
function pair(raw: unknown): string {
  const s = String(raw ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!s) return '';
  return s.endsWith('USDT') ? s : `${s}USDT`;
}

function side(raw: unknown): 'long' | 'short' {
  return String(raw ?? '').toLowerCase() === 'short' ? 'short' : 'long';
}

const round = (n: number, d = 4) => (Number.isFinite(n) ? Number(n.toFixed(d)) : null);
const pct = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? null : Number(n.toFixed(2)));
const hoursSince = (iso: string | null) => (iso ? Number(((Date.now() - new Date(iso).getTime()) / 3_600_000).toFixed(1)) : null);
const tradeKeyOf = (p: Pick<BitgetPosition, 'symbol' | 'holdSide' | 'openedAt'>) => `${p.symbol}-${p.holdSide}-${p.openedAt}`;

function compactPosition(p: BitgetPosition) {
  return {
    symbol: p.symbol,
    side: p.holdSide,
    size: p.size,
    entry: p.entryPrice,
    mark: p.markPrice,
    leverage: p.leverage,
    marginUsd: round(p.marginUsd, 3),
    notionalUsd: round(p.notionalUsd, 2),
    pnlUsd: round(p.unrealizedPnlUsd, 3),
    roePct: pct(p.roePct),
    movePct: pct(favourableMovePct(p.holdSide, p.entryPrice, p.markPrice)),
    tp: p.takeProfitPrice,
    sl: p.stopLossPrice,
    liq: p.liquidationPrice,
    breakEven: p.breakEvenPrice,
    openedAt: p.openedAt,
    heldHours: hoursSince(p.openedAt),
    tradeKey: p.openedAt ? tradeKeyOf(p) : null,
  };
}

/**
 * Everything the /bitget AI chat (skill `bitget-ai`) can read and propose:
 * read-only tools over the live account, setup configs, journal, saved charts and
 * signals, plus `propose_bitget_action`, which only stores an action card — the
 * order is placed by BitgetAiActionService when the user confirms the card.
 */
@Injectable()
export class BitgetAiChatService {
  private readonly logger = new Logger(BitgetAiChatService.name);
  private readonly actionRepo = createBitgetAiActionRepository();

  constructor(
    private readonly bitget: BitgetService,
    private readonly setup: BitgetSetupService,
    private readonly journal: BitgetJournalService,
    private readonly charts: BitgetSetupChartService,
    private readonly autoTrade: BitgetAutoTradeService,
  ) {}

  /** Context appended to the skill prompt on every reply: account snapshot, page, recent cards. */
  async buildContext(conversationId: string, pageContext?: string | null): Promise<string> {
    const parts: string[] = [];
    if (pageContext) parts.push(`## Trang người dùng đang xem\n${pageContext}`);
    try {
      const r = await this.bitget.getOpenPositions();
      const capital = r.initialCapitalUsd;
      const share = capitalSharePct(r.totalMarginUsd, capital);
      parts.push(
        [
          '## Tài khoản (lúc gửi tin nhắn)',
          `- Vốn gốc: $${round(capital, 2)} · Equity: ${r.accountEquityUsd != null ? `$${round(r.accountEquityUsd, 2)}` : '—'} (${pct(r.equityChangePct) ?? '—'}%)`,
          `- ${r.positions.length} vị thế mở · ký quỹ đang dùng $${round(r.totalMarginUsd, 2)}${share != null ? ` (${pct(share)}% vốn)` : ''} · PnL chưa chốt $${round(r.totalUnrealizedPnlUsd, 2)}`,
          `- Vị thế: ${r.positions.map((p) => `${p.symbol.replace('USDT', '')} ${p.holdSide} ROE ${pct(p.roePct)}%${p.takeProfitPrice ? ` TP ${p.takeProfitPrice}` : ' (chưa TP)'}`).join(' · ') || 'không có'}`,
        ].join('\n'),
      );
    } catch (e) {
      parts.push(`## Tài khoản\nKhông đọc được (${(e as Error).message}). Dùng tool bitget_account để thử lại.`);
    }
    const actions = await this.actionRepo.listRecent(conversationId, 12).catch(() => []);
    if (actions.length) {
      parts.push(
        '## Thẻ đề xuất gần đây trong cuộc trò chuyện này\n' +
          actions
            .map((a) => `- ${a.createdAt.toISOString().slice(0, 16)} ${a.type} ${a.holdSide} ${a.symbol} ${JSON.stringify(a.params)} — ${STATUS_VI[a.status] ?? a.status}${a.error ? ` (${a.error.slice(0, 160)})` : ''}`)
            .join('\n'),
      );
    }
    return parts.join('\n\n');
  }

  tools(): ChatTool[] {
    return [
      this.accountTool(),
      this.positionsTool(),
      this.pendingOrdersTool(),
      this.historyTool(),
      this.setupTool(),
      this.journalTool(),
      this.chartsTool(),
      this.signalsTool(),
      this.proposeTool(),
    ] as ChatTool[];
  }

  // ── read-only tools ────────────────────────────────────────────────────

  private accountTool(): ChatTool<Record<string, never>, string> {
    return {
      name: 'bitget_account',
      description: 'Bitget futures account summary: capital, equity, margin in use (% of capital), unrealized PnL, position count.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const r = await this.bitget.getOpenPositions();
        if (!r.configured) return 'Bitget chưa cấu hình API key.';
        return JSON.stringify({
          capitalUsd: r.initialCapitalUsd,
          equityUsd: r.accountEquityUsd,
          equityChangePct: pct(r.equityChangePct),
          marginInUseUsd: round(r.totalMarginUsd, 3),
          marginInUsePctOfCapital: pct(capitalSharePct(r.totalMarginUsd, r.initialCapitalUsd)),
          unrealizedPnlUsd: round(r.totalUnrealizedPnlUsd, 3),
          openPositions: r.positions.length,
          longs: r.positions.filter((p) => p.holdSide === 'long').length,
          shorts: r.positions.filter((p) => p.holdSide === 'short').length,
          withoutTp: r.positions.filter((p) => !p.takeProfitPrice).map((p) => `${p.symbol} ${p.holdSide}`),
          fetchedAt: r.fetchedAt,
        });
      },
    };
  }

  private positionsTool(): ChatTool<{ symbol?: string; side?: string }, string> {
    return {
      name: 'bitget_positions',
      description:
        'Open Bitget positions (live): size, entry, mark, leverage, margin, PnL, ROE, TP/SL, liquidation, hours held, tradeKey. ' +
        'Optional filter by symbol and/or side. Use it to answer "đang có lệnh BTC long nào không".',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Optional coin, e.g. "BTC" or "BTCUSDT"' },
          side: { type: 'string', description: 'Optional "long" or "short"' },
        },
      },
      execute: async (input) => {
        const r = await this.bitget.getOpenPositions();
        if (!r.configured) return 'Bitget chưa cấu hình API key.';
        const sym = input?.symbol ? pair(input.symbol) : null;
        const sd = input?.side ? side(input.side) : null;
        const rows = r.positions.filter((p) => (!sym || p.symbol === sym) && (!sd || p.holdSide === sd));
        return JSON.stringify({ count: rows.length, positions: rows.map(compactPosition), fetchedAt: r.fetchedAt });
      },
    };
  }

  private pendingOrdersTool(): ChatTool<{ symbol?: string }, string> {
    return {
      name: 'bitget_pending_orders',
      description: 'Resting (unfilled) LIMIT orders on Bitget: orderId, symbol, side, price, size, leverage, margin. Needed for a CANCEL card.',
      inputSchema: { type: 'object', properties: { symbol: { type: 'string', description: 'Optional coin filter' } } },
      execute: async (input) => {
        const r = await this.bitget.listPendingLimitOrders();
        const sym = input?.symbol ? pair(input.symbol) : null;
        const orders = r.orders.filter((o) => !sym || o.symbol === sym);
        return JSON.stringify({ count: orders.length, orders });
      },
    };
  }

  private historyTool(): ChatTool<{ symbol?: string; limit?: number }, string> {
    return {
      name: 'bitget_history',
      description:
        'Closed Bitget trades with net PnL, fees, hold time. Without a symbol: overall summary + per-coin/side stats + the latest trades. ' +
        'With a symbol: that coin only.',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Optional coin' },
          limit: { type: 'number', description: 'How many latest trades to list (default 20, max 100)' },
        },
      },
      execute: async (input) => {
        const sym = input?.symbol ? pair(input.symbol) : undefined;
        const r = await this.bitget.getClosedHistory(null, sym);
        const limit = Math.min(100, Math.max(1, Number(input?.limit) || 20));
        const bySide = new Map<string, { n: number; wins: number; netUsd: number; holdH: number }>();
        for (const t of r.trades) {
          const k = `${t.symbol} ${t.holdSide}`;
          const e = bySide.get(k) ?? { n: 0, wins: 0, netUsd: 0, holdH: 0 };
          e.n += 1;
          if (t.netProfit > 0) e.wins += 1;
          e.netUsd += t.netProfit;
          e.holdH += (new Date(t.closedAt).getTime() - new Date(t.openedAt).getTime()) / 3_600_000;
          bySide.set(k, e);
        }
        const stats = [...bySide.entries()]
          .sort((a, b) => b[1].n - a[1].n)
          .slice(0, sym ? 2 : 30)
          .map(([k, e]) => ({ coinSide: k, trades: e.n, winRatePct: pct((e.wins / e.n) * 100), netUsd: round(e.netUsd, 3), avgHoldHours: round(e.holdH / e.n, 1) }));
        return JSON.stringify({
          summary: r.summary,
          perCoinSide: stats,
          latest: r.trades.slice(0, limit).map((t) => ({
            symbol: t.symbol,
            side: t.holdSide,
            open: t.openAvgPrice,
            close: t.closeAvgPrice,
            netUsd: round(t.netProfit, 3),
            netPct: pct(t.netProfitPct),
            feesUsd: round(t.feesUsd, 3),
            openedAt: t.openedAt,
            closedAt: t.closedAt,
            heldHours: round((new Date(t.closedAt).getTime() - new Date(t.openedAt).getTime()) / 3_600_000, 1),
            tradeKey: t.tradeKey,
          })),
        });
      },
    };
  }

  private setupTool(): ChatTool<{ symbol?: string }, string> {
    return {
      name: 'bitget_setup',
      description:
        'The trader\'s Setup tab: per coin/side leverage + margin config (used by default for every card), 0–5 star priority, ' +
        'the trader\'s written assessment of the coin, and the auto-trade switch + its latest run.',
      inputSchema: { type: 'object', properties: { symbol: { type: 'string', description: 'Optional coin — gives the full note' } } },
      execute: async (input) => {
        const sym = input?.symbol ? pair(input.symbol) : null;
        const [configs, prios, notes, autos] = await Promise.all([
          this.setup.list(),
          this.setup.listPriorities(),
          this.setup.listNotes(),
          this.autoTrade.list().catch(() => []),
        ]);
        const coins = new Set<string>([...configs.map((c) => c.symbol), ...prios.map((p) => p.symbol)]);
        const rows = [...coins]
          .filter((c) => !sym || c === sym)
          .map((c) => {
            const note = notes.find((n) => n.symbol === c)?.note ?? null;
            const auto = autos.find((a) => a.symbol === c);
            return {
              symbol: c,
              stars: prios.find((p) => p.symbol === c)?.priority ?? 0,
              long: configs.find((x) => x.symbol === c && x.holdSide === 'long') ?? null,
              short: configs.find((x) => x.symbol === c && x.holdSide === 'short') ?? null,
              note: note ? (sym ? note.slice(0, 6000) : note.slice(0, 220)) : null,
              autoTrade: auto ? { enabled: auto.enabled, latestRun: auto.latestRun } : null,
            };
          })
          .sort((a, b) => b.stars - a.stars);
        return JSON.stringify({ coins: rows });
      },
    };
  }

  private journalTool(): ChatTool<{ symbol?: string; side?: string; tradeKey?: string }, string> {
    return {
      name: 'bitget_journal',
      description:
        'Journal timeline of one trade (trader notes + system events like opened, DCA, TP changes, ROE milestones). ' +
        'Give tradeKey, or symbol (+ side): uses the open position, else the latest closed trade of that coin.',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: { type: 'string' },
          side: { type: 'string', description: '"long" or "short"' },
          tradeKey: { type: 'string', description: 'Exact tradeKey from bitget_positions / bitget_history' },
        },
      },
      execute: async (input) => {
        let keys: string[] = input?.tradeKey ? [input.tradeKey] : [];
        if (!keys.length) {
          const sym = pair(input?.symbol);
          if (!sym) return 'Cần symbol hoặc tradeKey.';
          const sd = input?.side ? side(input.side) : null;
          const open = (await this.bitget.getOpenPositions()).positions.filter((p) => p.symbol === sym && (!sd || p.holdSide === sd) && p.openedAt);
          keys = open.map(tradeKeyOf);
          if (!keys.length) {
            const last = (await this.bitget.getClosedHistory(50, sym)).trades.find((t) => !sd || t.holdSide === sd);
            if (last) keys = [last.tradeKey];
          }
        }
        if (!keys.length) return 'Không tìm thấy lệnh nào cho coin này.';
        const out = await Promise.all(
          keys.slice(0, 2).map(async (k) => ({
            tradeKey: k,
            entries: (await this.journal.list(k)).slice(-25).map((e) => ({
              at: e.createdAt,
              kind: e.kind,
              content: e.content.slice(0, 1500),
              images: e.images.length,
            })),
          })),
        );
        return JSON.stringify(out);
      },
    };
  }

  private chartsTool(): ChatTool<{ symbol: string; limit?: number }, string | ChatToolRichResult> {
    return {
      name: 'bitget_charts',
      description:
        'Saved chart snapshots of a coin (the trader\'s annotated Setup/trade charts with notes). Returns the list and attaches ' +
        'the newest images so you can look at them.',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: { type: 'string' },
          limit: { type: 'number', description: 'How many newest images to attach (default 2, max 4)' },
        },
        required: ['symbol'],
      },
      execute: async (input) => {
        const rows = (await this.charts.listSavedChartsBySymbol(pair(input.symbol))) as Array<{
          url: string;
          timeframe: string;
          tradeKey: string;
          note?: string | null;
          createdAt: Date | string;
        }>;
        if (!rows.length) return `Chưa có chart nào được lưu cho ${pair(input.symbol)}.`;
        const sorted = [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        const take = Math.min(4, Math.max(1, Number(input.limit) || 2));
        const images: Array<{ data: string; mimeType: string }> = [];
        for (const r of sorted.slice(0, take)) {
          try {
            const res = await fetch(r.url, { signal: AbortSignal.timeout(8000) });
            if (!res.ok) continue;
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.length > 4_000_000) continue;
            images.push({ data: buf.toString('base64'), mimeType: res.headers.get('content-type') ?? 'image/png' });
          } catch (e) {
            this.logger.warn(`Could not fetch chart ${r.url}: ${(e as Error).message}`);
          }
        }
        const text = JSON.stringify({
          total: rows.length,
          attachedImages: images.length,
          charts: sorted.slice(0, 15).map((r, i) => ({ attached: i < images.length, timeframe: r.timeframe, tradeKey: r.tradeKey, note: r.note ?? null, savedAt: r.createdAt })),
        });
        return images.length ? { kind: 'rich', text, images } : text;
      },
    };
  }

  private signalsTool(): ChatTool<{ symbols: string }, string> {
    return {
      name: 'bitget_signals',
      description: 'QQE signal state on H4 and D1 (long/short, bars since flip, fresh cross) plus H4 / 7d / 30d price change for coins.',
      inputSchema: {
        type: 'object',
        properties: { symbols: { type: 'string', description: 'Comma-separated coins, e.g. "BTC,ETH,LINK" (max 15)' } },
        required: ['symbols'],
      },
      execute: async (input) => {
        const list = String(input.symbols ?? '').split(',').map(pair).filter(Boolean).slice(0, 15);
        if (!list.length) return 'Cần ít nhất 1 coin.';
        const [qqe, changes] = await Promise.all([this.charts.getQqeSignals(list, ['4h', '1d']), this.charts.getPriceChanges(list)]);
        return JSON.stringify(
          list.map((s) => {
            const c = changes.find((x) => x.symbol === s);
            return {
              symbol: s,
              qqe: qqe.find((x) => x.symbol === s)?.signals ?? null,
              changeH4Pct: c?.changeH4 != null ? pct(c.changeH4 * 100) : null,
              change7dPct: c?.change7d != null ? pct(c.change7d * 100) : null,
              change30dPct: c?.change30d != null ? pct(c.change30d * 100) : null,
            };
          }),
        );
      },
    };
  }

  // ── proposal ───────────────────────────────────────────────────────────

  private proposeTool(): ChatTool<
    {
      type: string;
      symbol: string;
      side: string;
      orderType?: string;
      price?: number;
      marginUsd?: number;
      leverage?: number;
      takeProfitPrice?: number;
      closePct?: number;
      orderId?: string;
      reason?: string;
    },
    string
  > {
    return {
      name: 'propose_bitget_action',
      description:
        'Propose ONE action on the live Bitget account as a card the user must confirm (nothing is sent until they do; they can edit ' +
        'margin / leverage / price / TP). Types: OPEN (new position or add, MARKET/LIMIT, optional TP), DCA (add to an open position, ' +
        'MARKET/LIMIT, optional new TP for the whole position), SET_TP (set/move the take-profit of an open position), CLOSE ' +
        '(close closePct % of a position, 100 = all), CANCEL (cancel a pending limit order by orderId). There is NO stop-loss — never ' +
        'propose one. Margin/leverage default to the coin\'s Setup config when omitted.',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'OPEN | DCA | SET_TP | CLOSE | CANCEL' },
          symbol: { type: 'string', description: 'Coin, e.g. "BTC" or "BTCUSDT"' },
          side: { type: 'string', description: '"long" or "short"' },
          orderType: { type: 'string', description: 'OPEN/DCA: MARKET (now) or LIMIT (rest at price)' },
          price: { type: 'number', description: 'LIMIT price' },
          marginUsd: { type: 'number', description: 'Margin in USDT (default: Setup config)' },
          leverage: { type: 'number', description: 'Leverage (default: Setup config; an open position keeps its own)' },
          takeProfitPrice: { type: 'number', description: 'Take-profit trigger price (position level)' },
          closePct: { type: 'number', description: 'CLOSE: % of the position to close, 1–100' },
          orderId: { type: 'string', description: 'CANCEL: orderId from bitget_pending_orders' },
          reason: { type: 'string', description: 'Why, 1–2 sentences in Vietnamese (shown on the card and saved to the journal)' },
        },
        required: ['type', 'symbol', 'side'],
      },
      execute: async (input, context) => {
        if (!context?.conversationId) return 'Không có conversation — không tạo được thẻ.';
        const type = String(input.type ?? '').toUpperCase() as ActionType;
        if (!ACTION_TYPES.includes(type)) return `type phải là một trong ${ACTION_TYPES.join(', ')}.`;
        const symbol = pair(input.symbol);
        if (!symbol) return 'Thiếu symbol.';
        const holdSide = side(input.side);
        const r = await this.bitget.getOpenPositions();
        const position = r.positions.find((p) => p.symbol === symbol && p.holdSide === holdSide) ?? null;
        const tp = Number(input.takeProfitPrice) > 0 ? Number(input.takeProfitPrice) : null;
        const params: Record<string, unknown> = {};

        if (type === 'OPEN' || type === 'DCA') {
          if (type === 'DCA' && !position) return `Không có vị thế ${holdSide} ${symbol} để DCA. Dùng OPEN nếu muốn mở mới.`;
          const orderType = String(input.orderType ?? 'MARKET').toUpperCase() === 'LIMIT' ? 'LIMIT' : 'MARKET';
          const configs = await this.setup.list();
          const cfg = configs.find((c) => c.symbol === symbol && c.holdSide === holdSide);
          const marginUsd = Number(input.marginUsd) > 0 ? Number(input.marginUsd) : cfg && cfg.marginUsd > 0 ? cfg.marginUsd : null;
          if (marginUsd == null) return `${symbol} ${holdSide} chưa có Setup config (ký quỹ). Hỏi user ký quỹ, hoặc truyền marginUsd.`;
          const leverage = position ? position.leverage : Number(input.leverage) >= 1 ? Math.round(Number(input.leverage)) : cfg?.leverage ?? 20;
          const refPrice = position?.markPrice ?? (await this.bitget.getTickerPrice(symbol).catch(() => null));
          const price = orderType === 'LIMIT' ? Number(input.price) : null;
          if (orderType === 'LIMIT' && !(price! > 0)) return 'LIMIT cần price.';
          const entry = price ?? refPrice;
          if (tp != null && entry != null && (holdSide === 'long' ? tp <= entry : tp >= entry)) {
            return `TP ${tp} phải ${holdSide === 'long' ? 'cao hơn' : 'thấp hơn'} giá vào ${entry}. Sửa lại rồi gọi lại.`;
          }
          Object.assign(params, { orderType, price, marginUsd, leverage, takeProfitPrice: tp, refPrice });
          if (position && entry) {
            const addSize = sizeFromMargin(marginUsd, leverage, entry);
            const newAvg = averageEntry(position.size, position.entryPrice, addSize, entry);
            Object.assign(params, { prevAvg: position.entryPrice, newAvg: round(newAvg, 8), prevSize: position.size, addSize });
          }
        } else if (type === 'SET_TP') {
          if (!position) return `Không có vị thế ${holdSide} ${symbol}.`;
          if (tp == null) return 'SET_TP cần takeProfitPrice.';
          if (holdSide === 'long' ? tp <= position.markPrice : tp >= position.markPrice) {
            return `TP ${tp} phải ${holdSide === 'long' ? 'cao hơn' : 'thấp hơn'} giá hiện tại ${position.markPrice}.`;
          }
          Object.assign(params, { takeProfitPrice: tp, prevTp: position.takeProfitPrice, refPrice: position.markPrice, entry: position.entryPrice });
        } else if (type === 'CLOSE') {
          if (!position) return `Không có vị thế ${holdSide} ${symbol} để đóng.`;
          const closePct = Math.min(100, Math.max(1, Math.round(Number(input.closePct) || 100)));
          Object.assign(params, {
            closePct,
            refPrice: position.markPrice,
            entry: position.entryPrice,
            size: position.size,
            pnlUsd: round(position.unrealizedPnlUsd, 4),
          });
        } else {
          const orderId = String(input.orderId ?? '').trim();
          const pending = (await this.bitget.listPendingLimitOrders()).orders.find((o) => o.orderId === orderId);
          if (!pending) return `Không tìm thấy lệnh chờ ${orderId || '(trống)'} — gọi bitget_pending_orders để lấy orderId.`;
          Object.assign(params, { orderId, price: pending.price, size: pending.size, marginUsd: round(pending.marginUsd, 3) });
        }

        const action = await this.actionRepo.create({
          conversationId: context.conversationId,
          type,
          symbol,
          holdSide,
          params: params as object,
          reason: input.reason?.slice(0, 1000) ?? null,
        });
        return `Đã tạo thẻ ${type} ${holdSide} ${symbol} (id ${action.id}). User sẽ bấm xác nhận (có thể sửa số) hoặc bỏ qua — chưa có lệnh nào được gửi lên sàn.`;
      },
    };
  }
}
