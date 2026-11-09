import { Injectable } from '@nestjs/common';
import { createOkxAiActionRepository, createOrderJournalRepository, createOrderRepository } from '@app/db';

import { OKX_DEFAULT_MARGIN_USD, OKX_FIXED_LEVERAGE, OkxService, type OkxPosition } from '../../okx/okx.service';
import { OKX_SHORT_AI_SKILL_ID, OkxShortSkillService } from '../../okx/okx-short-skill.service';
import { ShortScoreService } from '../../short-score/short-score.service';
import { formatScore } from './short-score.tools';
import type { ChatTool } from '../contracts/chat-tool';

export { OKX_SHORT_AI_SKILL_ID };

const ACTION_TYPES = ['OPEN', 'DCA', 'SET_TP', 'CLOSE', 'CANCEL'] as const;
type ActionType = (typeof ACTION_TYPES)[number];

const STATUS_VI: Record<string, string> = {
  PROPOSED: 'đề xuất, chờ user',
  EXECUTED: 'đã thực hiện',
  FAILED: 'lỗi',
  DISMISSED: 'user bỏ qua',
};

function pair(raw: unknown): string {
  const s = String(raw ?? '').trim().toUpperCase().replace(/-SWAP$/, '').replace(/[^A-Z0-9]/g, '');
  if (!s) return '';
  return s.endsWith('USDT') ? s : `${s}USDT`;
}

const round = (v: number | null | undefined, d = 4) => (v != null && Number.isFinite(v) ? Number(v.toFixed(d)) : null);
const hoursSince = (iso: string | null) => (iso ? Number(((Date.now() - new Date(iso).getTime()) / 3_600_000).toFixed(1)) : null);

function compact(p: OkxPosition) {
  return {
    symbol: p.symbol,
    side: p.holdSide,
    size: round(p.size, 8),
    contracts: p.contracts,
    entry: p.entryPrice,
    mark: p.markPrice,
    leverage: p.leverage,
    marginUsd: round(p.marginUsd, 3),
    notionalUsd: round(p.notionalUsd, 2),
    pnlUsd: round(p.unrealizedPnlUsd, 3),
    roePct: round(p.roePct, 2),
    tp: p.takeProfitPrice,
    sl: p.stopLossPrice,
    liq: p.liquidationPrice,
    openedAt: p.openedAt,
    heldHours: hoursSince(p.openedAt),
  };
}

type OrderRow = {
  id: string;
  symbol: string;
  side: string;
  status: string;
  entryPrice: number;
  closePrice: number | null;
  quantity: number | null;
  leverage: number | null;
  pnl: number | null;
  openedAt: Date;
  closedAt: Date | null;
  source: string;
  note?: string | null;
};

/**
 * The /trades OKX AI chat (skill id kept as `okx-short-ai`): reads the live OKX account and the
 * /trades OKX orders, writes notes on those orders, reads / rewrites its own analysis skill,
 * and proposes LONG or SHORT cards (`okx_ai_actions`) that OkxAiActionService runs on confirm.
 * New positions are fixed to cross × OKX_FIXED_LEVERAGE, margin default OKX_DEFAULT_MARGIN_USD.
 */
@Injectable()
export class OkxShortAiChatService {
  private readonly actionRepo = createOkxAiActionRepository();
  private readonly orderRepo = createOrderRepository();
  private readonly journalRepo = createOrderJournalRepository();

  constructor(
    private readonly okx: OkxService,
    private readonly skill: OkxShortSkillService,
    private readonly shortScore: ShortScoreService,
  ) {}

  /** Appended to the fixed prompt on every reply: the live analysis skill, account snapshot, recent cards. */
  async buildContext(conversationId: string, pageContext?: string | null): Promise<string> {
    const parts: string[] = [];
    const sk = await this.skill.current();
    parts.push(
      `## Skill phân tích (${sk.isDefault ? 'bản mặc định, chưa lưu version nào' : `v${sk.version}, cập nhật ${sk.updatedAt?.slice(0, 16).replace('T', ' ')} UTC`})\n` +
        'Đây là phương pháp phân tích của người dùng — ưu tiên nó hơn kiến thức chung.\n\n' +
        sk.content,
    );
    const sc = await this.shortScore.latest().catch(() => null);
    if (sc) {
      const ageH = (Date.now() - new Date(sc.takenAt).getTime()) / 3_600_000;
      parts.push(`## Điểm SHORT gần nhất (đã lưu, ${ageH.toFixed(1)} giờ trước — gọi get_short_score để chấm lại)\n${formatScore(sc)}`);
    }
    if (pageContext) parts.push(`## Trang người dùng đang xem\n${pageContext}`);
    try {
      const r = await this.okx.getAccount();
      if (!r.configured) parts.push('## Tài khoản OKX\nChưa cấu hình API key.');
      else
        parts.push(
          [
            '## Tài khoản OKX (lúc gửi tin nhắn)',
            `- Equity: ${r.equityUsd != null ? `$${round(r.equityUsd, 2)}` : '—'} · khả dụng ${r.availableUsd != null ? `$${round(r.availableUsd, 2)}` : '—'} · chế độ vị thế ${r.posMode ?? '—'}`,
            ...(r.canTrade === false ? ['- ⚠ API key chỉ có quyền ĐỌC: thẻ lệnh sẽ bị từ chối khi xác nhận cho tới khi user bật quyền Trade. Báo user điều này khi tạo thẻ.'] : []),
            `- ${r.positions.length} vị thế mở · ký quỹ $${round(r.totalMarginUsd, 2)} · PnL chưa chốt $${round(r.totalUnrealizedPnlUsd, 2)}`,
            `- Vị thế: ${r.positions.map((p) => `${p.symbol.replace('USDT', '')} ${p.holdSide} ROE ${round(p.roePct, 2)}%${p.takeProfitPrice ? ` TP ${p.takeProfitPrice}` : ' (chưa TP)'}`).join(' · ') || 'không có'}`,
          ].join('\n'),
        );
    } catch (e) {
      parts.push(`## Tài khoản OKX\nKhông đọc được (${(e as Error).message}). Dùng tool okx_account để thử lại.`);
    }
    const actions = await this.actionRepo.listRecent(conversationId, 12).catch(() => []);
    if (actions.length) {
      parts.push(
        '## Thẻ đề xuất gần đây trong cuộc trò chuyện này\n' +
          actions
            .map((a) => `- ${a.createdAt.toISOString().slice(0, 16)} ${a.type} ${a.symbol} ${JSON.stringify(a.params)} — ${STATUS_VI[a.status] ?? a.status}${a.error ? ` (${a.error.slice(0, 160)})` : ''}`)
            .join('\n'),
      );
    }
    return parts.join('\n\n');
  }

  tools(): ChatTool[] {
    return [
      this.accountTool(),
      this.positionsTool(),
      this.pendingTool(),
      this.tradesTool(),
      this.notesTool(),
      this.addNoteTool(),
      this.getSkillTool(),
      this.updateSkillTool(),
      this.proposeTool(),
    ] as ChatTool[];
  }

  // ── reads ─────────────────────────────────────────────────────────────────

  private accountTool(): ChatTool<Record<string, never>, string> {
    return {
      name: 'okx_account',
      description: 'OKX SWAP account summary: equity, available USDT, margin in use, unrealized PnL, position mode, open positions count.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const r = await this.okx.getAccount();
        if (!r.configured) return 'OKX chưa cấu hình API key.';
        return JSON.stringify({
          equityUsd: round(r.equityUsd, 2),
          availableUsd: round(r.availableUsd, 2),
          marginInUseUsd: round(r.totalMarginUsd, 3),
          marginInUsePctOfEquity: r.equityUsd ? round((r.totalMarginUsd / r.equityUsd) * 100, 2) : null,
          unrealizedPnlUsd: round(r.totalUnrealizedPnlUsd, 3),
          posMode: r.posMode,
          canTrade: r.canTrade,
          openPositions: r.positions.length,
          shorts: r.positions.filter((p) => p.holdSide === 'short').length,
          longs: r.positions.filter((p) => p.holdSide === 'long').length,
          positionsWithoutTp: r.positions.filter((p) => !p.takeProfitPrice).map((p) => `${p.symbol} ${p.holdSide}`),
          orderConfig: { marginMode: 'cross', leverageForNewPositions: OKX_FIXED_LEVERAGE, defaultMarginUsd: OKX_DEFAULT_MARGIN_USD },
          fetchedAt: r.fetchedAt,
        });
      },
    };
  }

  private positionsTool(): ChatTool<{ symbol?: string }, string> {
    return {
      name: 'okx_positions',
      description: 'Live OKX positions: size (coin + contracts), entry, mark, leverage, margin, PnL, ROE, TP/SL, liquidation, hours held. Optional symbol filter.',
      inputSchema: { type: 'object', properties: { symbol: { type: 'string', description: 'Optional coin, e.g. "BTC"' } } },
      execute: async (input) => {
        const sym = input?.symbol ? pair(input.symbol) : null;
        const rows = (await this.okx.getPositions()).filter((p) => !sym || p.symbol === sym);
        return JSON.stringify({ count: rows.length, positions: rows.map(compact) });
      },
    };
  }

  private pendingTool(): ChatTool<{ symbol?: string }, string> {
    return {
      name: 'okx_pending_orders',
      description: 'Resting (unfilled) orders on OKX SWAP: orderId, symbol, side, price, size, leverage, margin. Needed for a CANCEL card.',
      inputSchema: { type: 'object', properties: { symbol: { type: 'string', description: 'Optional coin filter' } } },
      execute: async (input) => {
        const orders = await this.okx.listPendingOrders(input?.symbol ? pair(input.symbol) : undefined);
        return JSON.stringify({ count: orders.length, orders });
      },
    };
  }

  private tradesTool(): ChatTool<{ symbol?: string; status?: string; limit?: number }, string> {
    return {
      name: 'okx_trades',
      description:
        'OKX orders in the /trades table (synced from the exchange every 5 min, plus manual rows with broker OKX): orderId (the /trades id, used by ' +
        'add_order_note / okx_order_notes), symbol, side, status, entry, close, qty, PnL, open/close time, number of notes. Plus a short/long win summary of the closed ones.',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Optional coin' },
          status: { type: 'string', description: '"open", "closed" or omit for both' },
          limit: { type: 'number', description: 'Max rows (default 30, max 100)' },
        },
      },
      execute: async (input) => {
        const status = input?.status === 'open' || input?.status === 'closed' ? input.status : undefined;
        const limit = Math.min(100, Math.max(1, Number(input?.limit) || 30));
        const sym = input?.symbol ? pair(input.symbol) : undefined;
        const res = await this.orderRepo.listFiltered({ symbol: sym, status, brokers: ['OKX'], page: 1, pageSize: limit });
        const rows = res.data as unknown as OrderRow[];
        const noteCounts = await Promise.all(rows.map((o) => this.journalRepo.findByOrderId(o.id).then((n) => n.filter((x) => x.kind === 'manual').length).catch(() => 0)));
        const closed = rows.filter((o) => o.status === 'closed' && o.pnl != null);
        const stat = (side: string) => {
          const list = closed.filter((o) => o.side === side);
          const wins = list.filter((o) => (o.pnl ?? 0) > 0).length;
          return { closed: list.length, winRatePct: list.length ? round((wins / list.length) * 100, 1) : null, pnlUsd: round(list.reduce((s, o) => s + (o.pnl ?? 0), 0), 2) };
        };
        return JSON.stringify({
          total: res.total,
          summaryOfListed: { short: stat('short'), long: stat('long') },
          orders: rows.map((o, i) => ({
            orderId: o.id,
            symbol: o.symbol,
            side: o.side,
            status: o.status,
            entry: o.entryPrice,
            close: o.closePrice,
            qty: o.quantity,
            leverage: o.leverage,
            pnlUsd: round(o.pnl, 3),
            openedAt: o.openedAt,
            closedAt: o.closedAt,
            synced: o.source === 'okx',
            notes: noteCounts[i],
          })),
        });
      },
    };
  }

  private notesTool(): ChatTool<{ orderId: string }, string> {
    return {
      name: 'okx_order_notes',
      description: 'Journal timeline of one /trades order (trader notes, AI-chat notes, system open/close events), oldest first.',
      inputSchema: { type: 'object', properties: { orderId: { type: 'string', description: 'orderId from okx_trades' } }, required: ['orderId'] },
      execute: async (input) => {
        const order = await this.orderRepo.findById(String(input?.orderId ?? ''));
        if (!order) return 'Không tìm thấy lệnh — gọi okx_trades để lấy orderId.';
        const notes = await this.journalRepo.findByOrderId(order.id);
        return JSON.stringify({
          order: { orderId: order.id, symbol: order.symbol, side: order.side, status: order.status, entry: order.entryPrice, pnlUsd: order.pnl },
          legacyNote: order.note ?? null,
          notes: notes.slice(-40).map((n) => ({ at: n.createdAt, kind: n.kind, content: n.content.slice(0, 2000) })),
        });
      },
    };
  }

  // ── writes: note + skill ─────────────────────────────────────────────────

  private addNoteTool(): ChatTool<{ orderId?: string; symbol?: string; side?: string; content: string }, string> {
    return {
      name: 'add_order_note',
      description:
        'Save a note on one /trades OKX order (shown in that order\'s journal on /trades). Give orderId (from okx_trades), or symbol (+ side when the ' +
        'coin has both a long and a short open) to use the OPEN OKX order of that coin. Only when the user asks to note / ghi chú something. Content in Markdown, in the user\'s words.',
      inputSchema: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'orderId from okx_trades' },
          symbol: { type: 'string', description: 'Alternative: coin of an open OKX position' },
          side: { type: 'string', description: 'With symbol: "long" or "short" (needed only when both are open)' },
          content: { type: 'string', description: 'The note (Markdown)' },
        },
        required: ['content'],
      },
      execute: async (input) => {
        const content = String(input?.content ?? '').trim();
        if (!content) return 'Nội dung note trống.';
        let order: OrderRow | null = null;
        if (input?.orderId) order = (await this.orderRepo.findById(String(input.orderId))) as OrderRow | null;
        else if (input?.symbol) {
          const sym = pair(input.symbol);
          const res = await this.orderRepo.listFiltered({ symbol: sym, status: 'open', brokers: ['OKX'], page: 1, pageSize: 10 });
          const list = (res.data as unknown as OrderRow[]).filter((o) => o.symbol === sym);
          const side = String(input.side ?? '').toLowerCase();
          const match = side === 'long' || side === 'short' ? list.filter((o) => o.side === side) : list;
          if (match.length > 1) return `Có ${match.length} lệnh ${sym} đang mở — truyền side (long/short) hoặc gọi okx_trades rồi truyền orderId.`;
          order = match[0] ?? null;
        }
        if (!order) return 'Không tìm thấy lệnh OKX phù hợp trong /trades (lệnh mới khớp có thể chưa được sync — thử lại sau vài phút). Gọi okx_trades để xem danh sách.';
        const price = await this.okx.getTickerPrice(order.symbol).catch(() => null);
        const pnlUsd =
          order.status === 'open' && price != null && order.quantity
            ? (order.side === 'short' ? order.entryPrice - price : price - order.entryPrice) * order.quantity
            : order.pnl ?? undefined;
        const note = await this.journalRepo.create({
          orderId: order.id,
          content: `💬 _Từ OKX AI chat_\n\n${content.slice(0, 20000)}`,
          snapshot: { ...(price != null ? { price } : {}), entryPrice: order.entryPrice, ...(pnlUsd != null ? { pnlUsd } : {}) },
        });
        return `Đã lưu note (id ${note.id}) vào lệnh ${order.side} ${order.symbol} (orderId ${order.id}) trên /trades.`;
      },
    };
  }

  private getSkillTool(): ChatTool<{ version?: number }, string> {
    return {
      name: 'get_short_skill',
      description: 'The current editable analysis skill (full text + version), plus the version list. Pass version to read an older one.',
      inputSchema: { type: 'object', properties: { version: { type: 'number', description: 'Optional older version number' } } },
      execute: async (input) => {
        if (Number(input?.version) > 0) return JSON.stringify(await this.skill.getVersion(Number(input!.version)));
        const s = await this.skill.get();
        return JSON.stringify({ version: s.version, isDefault: s.isDefault, content: s.content, history: s.history.slice(0, 15) });
      },
    };
  }

  private updateSkillTool(): ChatTool<{ content: string; note?: string }, string> {
    return {
      name: 'update_short_skill',
      description:
        'Save a NEW version of the analysis skill (replaces the whole text; the old version stays in history). ONLY when the user explicitly asks to ' +
        'change the skill. Always call get_short_skill first and keep every part the user did not ask to change. Applies from the next message.',
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The complete new skill text (Markdown)' },
          note: { type: 'string', description: 'One line: what changed' },
        },
        required: ['content'],
      },
      execute: async (input, context) => {
        try {
          const v = await this.skill.update(String(input?.content ?? ''), input?.note ? String(input.note) : null, 'LLM', context?.conversationId ?? null);
          return `Đã lưu skill phân tích v${v.version} (${v.content.length} ký tự). Áp dụng từ tin nhắn tiếp theo.`;
        } catch (e) {
          return `Không lưu được: ${(e as Error).message}`;
        }
      },
    };
  }

  // ── proposal ──────────────────────────────────────────────────────────────

  private proposeTool(): ChatTool<
    { type: string; symbol: string; side?: string; orderType?: string; price?: number; marginUsd?: number; leverage?: number; takeProfitPrice?: number; closePct?: number; orderId?: string; reason?: string },
    string
  > {
    return {
      name: 'propose_okx_order',
      description:
        'Propose ONE LONG or SHORT action on the live OKX account as a card the user must confirm (nothing is sent until they do; they can edit margin / ' +
        'price / TP). Fixed config: cross margin, new positions always ' + OKX_FIXED_LEVERAGE + 'x leverage (an open position keeps its own), margin default $' +
        OKX_DEFAULT_MARGIN_USD + '. Types: OPEN (new position or add, MARKET/LIMIT, optional TP), DCA (add to the open position of that side), ' +
        'SET_TP (set/move its TP), CLOSE (close closePct %, 100 = all), CANCEL (cancel a pending order by orderId). side is required.',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'OPEN | DCA | SET_TP | CLOSE | CANCEL' },
          symbol: { type: 'string', description: 'Coin, e.g. "BTC" or "BTCUSDT"' },
          side: { type: 'string', description: '"long" or "short" (required)' },
          orderType: { type: 'string', description: 'OPEN/DCA: MARKET or LIMIT' },
          price: { type: 'number', description: 'LIMIT price (short: at/above the current price; long: at/below it)' },
          marginUsd: { type: 'number', description: `OPEN/DCA: margin in USDT (default ${OKX_DEFAULT_MARGIN_USD} when omitted)` },
          takeProfitPrice: { type: 'number', description: 'Take-profit trigger (short: below the entry; long: above the entry)' },
          closePct: { type: 'number', description: 'CLOSE: % of the position, 1–100' },
          orderId: { type: 'string', description: 'CANCEL: orderId from okx_pending_orders' },
          reason: { type: 'string', description: 'Why, 1–2 sentences in Vietnamese (shown on the card, saved to the order journal)' },
        },
        required: ['type', 'symbol', 'side'],
      },
      execute: async (input, context) => {
        if (!context?.conversationId) return 'Không có conversation — không tạo được thẻ.';
        const side = String(input.side ?? '').toLowerCase();
        if (side !== 'long' && side !== 'short') return 'side phải là "long" hoặc "short".';
        const isShort = side === 'short';
        // tp is on the profit side of `ref`: below for a short, above for a long.
        const tpWrongSide = (tpPx: number, ref: number) => (isShort ? tpPx >= ref : tpPx <= ref);
        const type = String(input.type ?? '').toUpperCase() as ActionType;
        if (!ACTION_TYPES.includes(type)) return `type phải là một trong ${ACTION_TYPES.join(', ')}.`;
        const symbol = pair(input.symbol);
        if (!symbol) return 'Thiếu symbol.';
        try {
          await this.okx.getInstrument(symbol);
        } catch (e) {
          return (e as Error).message;
        }
        const position = await this.okx.getPosition(symbol, side);
        const tp = Number(input.takeProfitPrice) > 0 ? Number(input.takeProfitPrice) : null;
        const params: Record<string, unknown> = {};

        if (type === 'OPEN' || type === 'DCA') {
          if (type === 'DCA' && !position) return `Không có vị thế ${side} ${symbol} để DCA. Dùng OPEN nếu muốn mở mới.`;
          const orderType = String(input.orderType ?? 'MARKET').toUpperCase() === 'LIMIT' ? 'LIMIT' : 'MARKET';
          const marginUsd = Number(input.marginUsd) > 0 ? Number(input.marginUsd) : OKX_DEFAULT_MARGIN_USD;
          const leverage = position ? position.leverage : OKX_FIXED_LEVERAGE;
          const refPrice = position?.markPrice ?? (await this.okx.getTickerPrice(symbol).catch(() => null));
          const price = orderType === 'LIMIT' ? Number(input.price) : null;
          if (orderType === 'LIMIT' && !(price! > 0)) return 'LIMIT cần price.';
          const entry = price ?? refPrice;
          if (tp != null && entry != null && tpWrongSide(tp, entry)) return `TP ${tp} của lệnh ${side} phải ${isShort ? 'thấp' : 'cao'} hơn giá vào ${entry}.`;
          Object.assign(params, { orderType, price, marginUsd, leverage, takeProfitPrice: tp, refPrice });
          if (position && entry) {
            const addSize = (marginUsd * leverage) / entry;
            const newAvg = (position.size * position.entryPrice + addSize * entry) / (position.size + addSize);
            Object.assign(params, { prevAvg: position.entryPrice, newAvg: round(newAvg, 8), prevSize: position.size, addSize: round(addSize, 8) });
          }
        } else if (type === 'SET_TP') {
          if (!position) return `Không có vị thế ${side} ${symbol}.`;
          if (tp == null) return 'SET_TP cần takeProfitPrice.';
          if (tpWrongSide(tp, position.markPrice)) return `TP ${tp} của ${side} phải ${isShort ? 'thấp' : 'cao'} hơn giá hiện tại ${position.markPrice}.`;
          Object.assign(params, { takeProfitPrice: tp, prevTp: position.takeProfitPrice, refPrice: position.markPrice, entry: position.entryPrice });
        } else if (type === 'CLOSE') {
          if (!position) return `Không có vị thế ${side} ${symbol} để đóng.`;
          const closePct = Math.min(100, Math.max(1, Math.round(Number(input.closePct) || 100)));
          Object.assign(params, { closePct, refPrice: position.markPrice, entry: position.entryPrice, size: position.size, pnlUsd: round(position.unrealizedPnlUsd, 4) });
        } else {
          const orderId = String(input.orderId ?? '').trim();
          const pending = (await this.okx.listPendingOrders(symbol)).find((o) => o.orderId === orderId);
          if (!pending) return `Không tìm thấy lệnh chờ ${orderId || '(trống)'} — gọi okx_pending_orders để lấy orderId.`;
          Object.assign(params, { orderId, price: pending.price, size: pending.size, marginUsd: round(pending.marginUsd, 3) });
        }

        const action = await this.actionRepo.create({
          conversationId: context.conversationId,
          type,
          symbol,
          holdSide: side,
          params: params as object,
          reason: input.reason?.slice(0, 1000) ?? null,
        });
        return `Đã tạo thẻ ${type} ${side} ${symbol} (id ${action.id}). User sẽ bấm xác nhận (có thể sửa số) hoặc bỏ qua — chưa có lệnh nào được gửi lên OKX.`;
      },
    };
  }
}
