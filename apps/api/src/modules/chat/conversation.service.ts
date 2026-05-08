import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { getSkillById } from '@app/skills';

import { CONVERSATION_REPOSITORY, ORDER_REPOSITORY } from '../database/database.providers';
import { ClaudeChatProvider } from './providers/claude-chat.provider';
import { ChatToolRegistry } from './contracts/chat-tool-registry';

type ConversationRepo = ReturnType<typeof import('@app/db').createConversationRepository>;
type OrderRepo = ReturnType<typeof import('@app/db').createOrderRepository>;

@Injectable()
export class ConversationService {
  constructor(
    @Inject(CONVERSATION_REPOSITORY)
    private readonly convRepo: ConversationRepo,
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepo: OrderRepo,
    private readonly claude: ClaudeChatProvider,
    private readonly toolRegistry: ChatToolRegistry
  ) {}

  // ── CRUD ──────────────────────────────────────────────────────────────

  createConversation(userId: string, title?: string, skillId?: string) {
    return this.convRepo.create(userId, title ?? 'Cuộc trò chuyện mới', skillId);
  }

  async listConversations(userId: string, skillId?: string) {
    return this.convRepo.listByUser(userId, skillId);
  }

  async getConversationMessages(id: string, userId: string) {
    const conv = await this.convRepo.findById(id);
    if (!conv || conv.userId !== userId) throw new NotFoundException('Conversation not found');
    return this.convRepo.listMessages(id);
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

    // Save user message
    await this.convRepo.addMessage(conversationId, 'user', content);

    // Auto-update title from first message
    if (conv.title === 'Cuộc trò chuyện mới') {
      const title = content.slice(0, 80).trim();
      await this.convRepo.updateTitle(conversationId, title);
    }

    // Load full history (includes just-saved user message)
    const history = await this.convRepo.listMessages(conversationId);

    // Resolve skill (if any)
    const skill = conv.skillId ? getSkillById(conv.skillId) : undefined;

    // Build system prompt — skill-specific or general
    const systemPrompt = await this.buildSystemPrompt(userId, skill?.systemPrompt);

    // Filter tools to skill's allowed list, or use all tools for general chat
    const allTools = this.toolRegistry.listTools();
    const tools = skill
      ? allTools.filter((t) => skill.tools.includes(t.name))
      : allTools;

    // Call Claude with agentic tool loop
    const reply = await this.claude.chatAgentLoop(
      systemPrompt,
      history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      tools,
      async (name, input) => {
        const tool = this.toolRegistry.getTool(name);
        if (!tool) return `Tool "${name}" not found`;
        const result = await tool.execute(input);
        return typeof result === 'string' ? result : JSON.stringify(result);
      }
    );

    // Save assistant response
    const assistantMsg = await this.convRepo.addMessage(conversationId, 'assistant', reply);

    // Touch conversation updatedAt
    await this.convRepo.touch(conversationId);

    return assistantMsg;
  }

  // ── System prompt ─────────────────────────────────────────────────────

  private async buildSystemPrompt(_userId: string, skillSystemPrompt?: string): Promise<string> {
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

    const generalPrompt = `Bạn là trợ lý giao dịch crypto chuyên nghiệp tích hợp trực tiếp vào dashboard của trader.

Thời gian hiện tại: ${now} (GMT+7)

Hồ sơ giao dịch của người dùng:
${tradeContext}

Bạn có thể sử dụng các công cụ sau để lấy dữ liệu thị trường thực từ Binance:
- get_klines: lấy nến OHLCV theo khung thời gian
- get_ticker_price: lấy giá hiện tại
- get_24h_ticker: thống kê 24h (high, low, volume, % thay đổi)
- analyze_market_structure: phân tích cấu trúc thị trường đa khung thời gian (1W/1D/4H)

Hướng dẫn:
1. Dùng công cụ khi cần phân tích kỹ thuật hoặc người dùng hỏi về giá/biểu đồ hiện tại.
2. Khi phân tích nến, hãy xem xét: xu hướng, hỗ trợ/kháng cự, momentum, volume.
3. Khi đưa ra điểm vào lệnh, luôn kèm: entry zone, stop loss, take profit, lý do.
4. Ngắn gọn, thực tế, có thể hành động được.
5. Phản hồi bằng ngôn ngữ người dùng đang dùng (Tiếng Việt hoặc English).
6. Không đưa ra lời khuyên tài chính tuyệt đối — luôn nhắc quản lý rủi ro.`;

    if (skillSystemPrompt) {
      return `${skillSystemPrompt}\n\n---\n\nThời gian hiện tại: ${now} (GMT+7)\n\nHồ sơ giao dịch của người dùng:\n${tradeContext}`;
    }

    return generalPrompt;
  }
}
