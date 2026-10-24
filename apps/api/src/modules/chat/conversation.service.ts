import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createSkillTradeSetupRepository, createStrategyPaperTradeRepository, createTrackingSetupRepository } from '@app/db';
import { getSkillById } from '@app/skills';

import { CONVERSATION_REPOSITORY, HOLDING_REPOSITORY, COIN_TRANSACTION_REPOSITORY, ORDER_REPOSITORY } from '../database/database.providers';
import { buildTrackingContext, TRACKING_SKILL_ID } from '../tracking-trades/tracking-context';
import { ClaudeChatProvider } from './providers/claude-chat.provider';
import { ChatToolRegistry } from './contracts/chat-tool-registry';

type ConversationRepo = ReturnType<typeof import('@app/db').createConversationRepository>;
type OrderRepo = ReturnType<typeof import('@app/db').createOrderRepository>;
type HoldingRepo = ReturnType<typeof import('@app/db').createHoldingRepository>;
type CoinTransactionRepo = ReturnType<typeof import('@app/db').createCoinTransactionRepository>;

/**
 * In-memory state of a reply being generated, polled by the chat UI (GET …/live) so it can show
 * the tool being run and stream the text as it's written. Kept briefly after it ends so the UI
 * sees the final phase; this process is the only writer, so memory is enough.
 */
type LiveReply = {
  phase: 'thinking' | 'tool' | 'writing' | 'done' | 'stopped' | 'error';
  tool: string | null;
  text: string;
  error: string | null;
  startedAt: number;
  abort: AbortController;
};

export type LiveReplyDto = {
  active: boolean;
  phase: LiveReply['phase'] | 'idle';
  tool: string | null;
  text: string;
  error: string | null;
  elapsedMs: number;
};

const LIVE_KEEP_MS = 60_000;
const isActive = (l: LiveReply | undefined) => l != null && (l.phase === 'thinking' || l.phase === 'tool' || l.phase === 'writing');

/** Every skill can read the user's /tracking-coins list through get_tracking_coins. */
const WATCHLIST_HINT =
  'Danh sách coin người dùng đang theo dõi (trang Tracking Coins): gọi get_tracking_coins khi user nói "coin của tôi", ' +
  '"danh sách", "list", hoặc nhờ chọn coin. Dùng nó để lọc trước, rồi chỉ lấy dữ liệu chi tiết cho tối đa 3 coin đáng chú ý nhất.';

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);
  private readonly setupRepo = createSkillTradeSetupRepository();
  private readonly paperTradeRepo = createStrategyPaperTradeRepository();
  private readonly trackingRepo = createTrackingSetupRepository();
  private readonly live = new Map<string, LiveReply>();

  constructor(
    @Inject(CONVERSATION_REPOSITORY)
    private readonly convRepo: ConversationRepo,
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepo: OrderRepo,
    @Inject(HOLDING_REPOSITORY)
    private readonly holdingRepo: HoldingRepo,
    @Inject(COIN_TRANSACTION_REPOSITORY)
    private readonly txRepo: CoinTransactionRepo,
    private readonly claude: ClaudeChatProvider,
    private readonly toolRegistry: ChatToolRegistry
  ) {}

  // ── CRUD ──────────────────────────────────────────────────────────────

  createConversation(userId: string, title?: string, skillId?: string, coinId?: string, portfolioId?: string, symbol?: string) {
    const metadata = coinId && portfolioId ? { coinId, portfolioId } : symbol ? { symbol: symbol.toUpperCase() } : undefined;
    return this.convRepo.create(userId, title ?? 'Cuộc trò chuyện mới', skillId, metadata);
  }

  async listConversations(userId: string, skillId?: string) {
    return this.convRepo.listByUser(userId, skillId);
  }

  async getConversationMessages(id: string, userId: string) {
    const conv = await this.convRepo.findById(id);
    if (!conv || conv.userId !== userId) throw new NotFoundException('Conversation not found');
    const [rawMessages, setups, tracking] = await Promise.all([
      this.convRepo.listMessages(id),
      this.setupRepo.listByConversation(id),
      this.trackingRepo.listByConversation(id)
    ]);
    // Swing setups proposed in a /tracking-coins panel chat, with their current status.
    const trackingByMessage = new Map<string, unknown[]>();
    for (const t of tracking) {
      if (t.messageId) trackingByMessage.set(t.messageId, [...(trackingByMessage.get(t.messageId) ?? []), t]);
    }
    const messages = rawMessages.map((m) => (trackingByMessage.has(m.id) ? { ...m, trackingSetups: trackingByMessage.get(m.id) } : m));
    if (setups.length === 0) return messages;

    // Accepted setups carry their paper trade's live status so the chat can show progress.
    const trades = await Promise.all(
      setups.map((s) => (s.paperTradeId ? this.paperTradeRepo.findById(s.paperTradeId) : Promise.resolve(null)))
    );
    const byMessage = new Map<string, unknown[]>();
    setups.forEach((s, i) => {
      if (!s.messageId) return;
      const t = trades[i];
      const list = byMessage.get(s.messageId) ?? [];
      list.push({
        ...s,
        trade: t
          ? { id: t.id, status: t.status, entryPrice: t.entryPrice, stopLoss: t.stopLoss, exitPrice: t.exitPrice, pnlUsd: t.pnlUsd, rMultiple: t.rMultiple }
          : null
      });
      byMessage.set(s.messageId, list);
    });
    return messages.map((m) => (byMessage.has(m.id) ? { ...m, setups: byMessage.get(m.id) } : m));
  }

  async deleteConversation(id: string, userId: string) {
    const conv = await this.convRepo.findById(id);
    if (!conv || conv.userId !== userId) throw new NotFoundException('Conversation not found');
    return this.convRepo.remove(id);
  }

  async updateTitle(id: string, userId: string, title: string) {
    const conv = await this.convRepo.findById(id);
    if (!conv || conv.userId !== userId) throw new NotFoundException('Conversation not found');
    return this.convRepo.updateTitle(id, title);
  }

  // ── Send message ──────────────────────────────────────────────────────

  async sendMessage(conversationId: string, userId: string, content: string) {
    const conv = await this.convRepo.findById(conversationId);
    if (!conv || conv.userId !== userId) throw new NotFoundException('Conversation not found');
    if (isActive(this.live.get(conversationId))) {
      throw new BadRequestException('Claude đang trả lời tin nhắn trước — đợi xong hoặc bấm Dừng.');
    }

    // Save user message immediately and return — LLM runs in background
    const userMsg = await this.convRepo.addMessage(conversationId, 'user', content);

    // Auto-update title from first message
    if (conv.title === 'Cuộc trò chuyện mới') {
      const title = content.slice(0, 80).trim();
      void this.convRepo.updateTitle(conversationId, title);
    }

    // Kick off LLM processing without blocking the HTTP response
    void this.processLlmResponse(
      conversationId,
      conv.userId,
      conv.skillId ?? undefined,
      conv.metadata as Record<string, string> | null
    );

    return userMsg;
  }

  // ── Live reply (progress / stop / retry) ─────────────────────────────

  async getLive(conversationId: string, userId: string): Promise<LiveReplyDto> {
    const conv = await this.convRepo.findById(conversationId);
    if (!conv || conv.userId !== userId) throw new NotFoundException('Conversation not found');
    const l = this.live.get(conversationId);
    if (!l) return { active: false, phase: 'idle', tool: null, text: '', error: null, elapsedMs: 0 };
    return { active: isActive(l), phase: l.phase, tool: l.tool, text: l.text, error: l.error, elapsedMs: Date.now() - l.startedAt };
  }

  async stopReply(conversationId: string, userId: string): Promise<{ stopped: boolean }> {
    const conv = await this.convRepo.findById(conversationId);
    if (!conv || conv.userId !== userId) throw new NotFoundException('Conversation not found');
    const l = this.live.get(conversationId);
    if (!isActive(l)) return { stopped: false };
    l!.abort.abort();
    return { stopped: true };
  }

  /** Re-run the reply to the last user message (after an error or a stop). */
  async retryReply(conversationId: string, userId: string): Promise<{ started: boolean }> {
    const conv = await this.convRepo.findById(conversationId);
    if (!conv || conv.userId !== userId) throw new NotFoundException('Conversation not found');
    if (isActive(this.live.get(conversationId))) return { started: false };
    const messages = await this.convRepo.listMessages(conversationId);
    if (messages[messages.length - 1]?.role !== 'user') {
      throw new BadRequestException('Không có tin nhắn nào đang chờ trả lời.');
    }
    void this.processLlmResponse(conversationId, conv.userId, conv.skillId ?? undefined, conv.metadata as Record<string, string> | null);
    return { started: true };
  }

  private async processLlmResponse(
    conversationId: string,
    userId: string,
    skillId: string | undefined,
    meta: Record<string, string> | null
  ): Promise<void> {
    const startedAt = new Date();
    const live: LiveReply = { phase: 'thinking', tool: null, text: '', error: null, startedAt: startedAt.getTime(), abort: new AbortController() };
    this.live.set(conversationId, live);
    const finish = (phase: LiveReply['phase'], error: string | null = null) => {
      live.phase = phase;
      live.error = error;
      setTimeout(() => {
        if (this.live.get(conversationId) === live) this.live.delete(conversationId);
      }, LIVE_KEEP_MS);
    };
    try {
      const history = await this.convRepo.listMessages(conversationId);
      const skill = skillId ? getSkillById(skillId) : undefined;
      const coinId = meta?.coinId;
      const portfolioId = meta?.portfolioId;
      const tracking = skillId === TRACKING_SKILL_ID;
      const systemPrompt = tracking
        ? `${skill!.systemPrompt}\n\n---\n\nThời gian hiện tại: ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} (GMT+7)\n\n${await buildTrackingContext(meta?.symbol)}`
        : await this.buildSystemPrompt(userId, skill?.systemPrompt, coinId, portfolioId);
      const allTools = this.toolRegistry.listTools();
      // The propose_* tools create setup cards — only for skills that opt into them.
      const tools = skill
        ? allTools.filter((t) => skill.tools.includes(t.name))
        : allTools.filter((t) => !t.name.startsWith('propose_'));

      const reply = await this.claude.chatAgentLoop(
        systemPrompt,
        history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        tools,
        async (name, input) => {
          const tool = this.toolRegistry.getTool(name);
          if (!tool) return `Tool "${name}" not found`;
          const result = await tool.execute(input, { conversationId, skillId });
          return typeof result === 'string' ? result : JSON.stringify(result);
        },
        {
          signal: live.abort.signal,
          onProgress: (ev) => {
            if (ev.type === 'tool') {
              live.phase = 'tool';
              live.tool = ev.name;
              live.text = '';
            } else {
              live.phase = 'writing';
              live.text = ev.text;
            }
          }
        }
      );

      const assistantMsg = await this.convRepo.addMessage(conversationId, 'assistant', reply);
      await this.setupRepo.attachToMessage(conversationId, assistantMsg.id, startedAt);
      await this.trackingRepo.attachToMessage(conversationId, assistantMsg.id, startedAt);
      // The first answer of a coin's panel chat is its analysis — keep it on the coin's timeline.
      if (tracking && meta?.symbol && !history.some((m) => m.role === 'assistant')) {
        await this.trackingRepo.addEvent({
          symbol: meta.symbol,
          type: 'ANALYSIS',
          message: reply.slice(0, 20000),
          data: { conversationId, messageId: assistantMsg.id }
        });
      }
      await this.convRepo.touch(conversationId);
      finish('done');
    } catch (error) {
      if (live.abort.signal.aborted) {
        // Stopped by the user: keep whatever was already written, marked as cut short.
        if (live.text.trim()) {
          const msg = await this.convRepo.addMessage(conversationId, 'assistant', `${live.text.trim()}\n\n_(Đã dừng)_`);
          await this.setupRepo.attachToMessage(conversationId, msg.id, startedAt);
          await this.trackingRepo.attachToMessage(conversationId, msg.id, startedAt);
          await this.convRepo.touch(conversationId);
        }
        finish('stopped');
        return;
      }
      this.logger.error(`LLM processing failed for conversation ${conversationId}: ${String(error)}`);
      const timedOut = /aborted/i.test(String(error));
      finish('error', timedOut ? 'Quá thời gian xử lý (5 phút).' : 'Claude gặp lỗi khi trả lời.');
    }
  }

  async generateTitle(id: string, userId: string): Promise<{ title: string }> {
    const conv = await this.convRepo.findById(id);
    if (!conv || conv.userId !== userId) throw new NotFoundException('Conversation not found');
    const messages = await this.convRepo.listMessages(id);
    const firstUserMsg = messages.find((m) => m.role === 'user');
    if (!firstUserMsg) return { title: conv.title };
    const title = await this.claude.generateTitle(firstUserMsg.content);
    await this.convRepo.updateTitle(id, title);
    return { title };
  }

  // ── System prompt ─────────────────────────────────────────────────────

  private async buildCoinContext(coinId: string, portfolioId: string): Promise<string> {
    try {
      const [holding, transactions] = await Promise.all([
        this.holdingRepo.findByPortfolioAndCoin(portfolioId, coinId),
        this.txRepo.listByPortfolio(portfolioId, { coinId })
      ]);

      if (!holding) return '';

      const totalAmount = Number(holding.totalAmount);
      const avgCost = Number(holding.avgCost);
      const totalInvested = Number(holding.totalCost);
      const realizedPnl = Number(holding.realizedPnl);
      const note = holding.note?.trim() || null;

      // Separate and sort chronologically
      const buys  = transactions.filter((tx) => tx.type === 'buy').sort((a, b) => new Date(a.transactedAt).getTime() - new Date(b.transactedAt).getTime());
      const sells = transactions.filter((tx) => tx.type === 'sell').sort((a, b) => new Date(a.transactedAt).getTime() - new Date(b.transactedAt).getTime());

      const buyPrices = buys.map((tx) => Number(tx.price));
      const minBuy    = buyPrices.length > 0 ? Math.min(...buyPrices) : 0;
      const maxBuy    = buyPrices.length > 0 ? Math.max(...buyPrices) : 0;

      const fmtDate = (d: Date | string) =>
        new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

      const buyLinesCmp  = buys.map((tx) => `${Number(tx.amount).toFixed(6)}@$${Number(tx.price).toLocaleString()}(${fmtDate(tx.transactedAt)})`).join(', ');
      const sellLinesCmp = sells.map((tx) => `${Number(tx.amount).toFixed(6)}@$${Number(tx.price).toLocaleString()}(${fmtDate(tx.transactedAt)})`).join(', ');

      return `[${coinId} Portfolio]
Giữ: ${totalAmount} ${coinId} | Avg: $${avgCost.toLocaleString()} | Vốn: $${totalInvested.toLocaleString()} | PnL: ${realizedPnl >= 0 ? '+' : ''}$${realizedPnl.toLocaleString()}
${note ? `Mục tiêu: ${note}` : ''}
Mua(${buys.length}, min$${minBuy.toLocaleString()}/max$${maxBuy.toLocaleString()}): ${buyLinesCmp || 'none'}
${sells.length > 0 ? `Bán(${sells.length}): ${sellLinesCmp}` : 'Chưa bán.'}
DCA formula: new_avg=(${totalInvested.toFixed(2)}+B)/(${totalAmount}+B/P) với B=budget, P=dcaPrice`;
    } catch {
      return '';
    }
  }

  private async buildSystemPrompt(_userId: string, skillSystemPrompt?: string, coinId?: string, portfolioId?: string): Promise<string> {
    // Fetch user's trade history for context
    let tradeContext = 'Không có dữ liệu giao dịch.';
    try {
      const orders = (await this.orderRepo.listLatest(200)) as Array<{
        symbol?: string;
        side?: string;
        status?: string;
        pnl?: number | null;
        entryPrice?: number;
        closePrice?: number | null;
        openedAt?: Date;
        closedAt?: Date | null;
      }>;

      const closed = orders.filter((o) => o.status === 'closed' && o.pnl != null);
      const open   = orders.filter((o) => o.status === 'open');

      if (closed.length > 0) {
        const totalPnl   = closed.reduce((s, o) => s + (o.pnl ?? 0), 0);
        const wins       = closed.filter((o) => (o.pnl ?? 0) > 0);
        const winRate    = ((wins.length / closed.length) * 100).toFixed(1);
        const totalWin   = wins.reduce((s, o) => s + (o.pnl ?? 0), 0);
        const totalLoss  = Math.abs(closed.filter((o) => (o.pnl ?? 0) < 0).reduce((s, o) => s + (o.pnl ?? 0), 0));
        const profitFactor = totalLoss > 0 ? (totalWin / totalLoss).toFixed(2) : 'N/A';

        // Symbol breakdown
        const bySymbol = new Map<string, number>();
        for (const o of closed) {
          const sym = o.symbol ?? 'UNKNOWN';
          bySymbol.set(sym, (bySymbol.get(sym) ?? 0) + 1);
        }
        const topSymbols = Array.from(bySymbol.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([s, n]) => `${s}(${n})`)
          .join(', ');

        // Recent 5 closed trades
        const recent = closed.slice(0, 5).map((o) => {
          const pnlStr = (o.pnl ?? 0) >= 0 ? `+${(o.pnl ?? 0).toFixed(2)}` : `${(o.pnl ?? 0).toFixed(2)}`;
          return `  - ${o.symbol} ${o.side?.toUpperCase()} @ ${o.entryPrice} → ${o.closePrice} (PnL: ${pnlStr} USDT)`;
        }).join('\n');

        tradeContext = `
Tổng lệnh đã đóng: ${closed.length} | Lệnh đang mở: ${open.length}
Win rate: ${winRate}% | Profit factor: ${profitFactor}
Tổng PnL: ${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)} USDT
Các cặp hay giao dịch nhất: ${topSymbols}
5 lệnh gần nhất:
${recent}`;
      }
    } catch {
      // ignore — use default message
    }

    const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

    const coinContext = coinId && portfolioId ? await this.buildCoinContext(coinId, portfolioId) : '';

    const generalPrompt = `Crypto trading assistant. ${now} GMT+7.
${tradeContext}
Tools: get_klines, get_ticker_price, get_24h_ticker, analyze_market_structure(1W/1D/4H), get_tracking_coins (danh sách coin user đang theo dõi).
Dùng tool khi cần số liệu thực. Mỗi đề xuất lệnh kèm entry/SL/TP/lý do. Ngắn gọn, có thể hành động. Reply cùng ngôn ngữ user. Không tư vấn tài chính tuyệt đối.`;

    if (skillSystemPrompt) {
      return `${skillSystemPrompt}\n\n---\n\nThời gian hiện tại: ${now} (GMT+7)\n\n${WATCHLIST_HINT}\n\nHồ sơ giao dịch của người dùng:\n${tradeContext}`;
    }

    if (coinContext && coinId) {
      return this.buildCoinSwingPaPrompt(coinId, coinContext, now);
    }

    return generalPrompt;
  }

  private buildCoinSwingPaPrompt(coinId: string, coinContext: string, now: string): string {
    const symbol = coinId.endsWith('USDT') ? coinId : `${coinId}USDT`;

    return `Swing PA analyst – ${coinId} portfolio. ${now} GMT+7.
${coinContext}

Khi phân tích DCA/chốt lời: gọi analyze_market_structure("${symbol}") trước, sau đó:
- Trend: 1W→1D→4H (HH/HL structure, CHoCH). Chỉ DCA chiều weekly.
- DCA zones (ưu tiên cao→thấp): Fib0.618+SR≥2touch > Fib0.5+SR > Fib0.382+SR > SR độc lập > last HL. Chỉ R:R≥2.
- TP: nearest resistance(TP1 50-60%), next resistance(TP2 30-40%), Fib1.618ext(TP3 10-20%).
- Tính new_avg bằng DCA formula cho mỗi vùng DCA, giả định budget = lần mua lớn nhất.

Output (tiếng Việt, số thực):
📊 Trend: 1W/1D/4H | CHoCH | Fib pivot
🎯 DCA: bảng [vùng | lý do | new_avg | Δavg% | SL | R:R]
💰 TP1/TP2/TP3: giá + %profit từ new_avg + locked$
📊 So sánh: không DCA vs DCA#1 vs DCA#1+2 (avg_cost, profit@TP1, profit@TP2)
⛔ Invalidation level
📌 Nhận xét vị thế (lãi/lỗ%, nên DCA vùng nào, cảnh báo CHoCH nếu có)`;
  }
}
