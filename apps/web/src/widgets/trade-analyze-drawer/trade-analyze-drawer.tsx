'use client';

import { useEffect, useRef, useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import { renderMarkdown } from '@web/shared/lib/markdown';
import type { ChatMessage, DashboardOrder } from '@web/shared/api/types';

type Props = Readonly<{
  order: DashboardOrder;
  livePrice?: number;
  onClose: () => void;
}>;

function TypingIndicator() {
  return <div className="chat-typing"><span /><span /><span /></div>;
}

const STORAGE_KEY = (orderId: string) => `trade-analyze:${orderId}`;

function formatPrice(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value);
}

function formatDate(date: Date | null | undefined): string {
  if (!date) return '-';
  const d = new Date(date);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function buildInitialPrompt(order: DashboardOrder, livePrice?: number): string {
  const isOpen = order.status.toLowerCase() === 'open';
  const side = order.side.toUpperCase();
  const qty = order.quantity;
  const volume = qty != null ? qty * order.entryPrice : null;

  let unrealPnl: number | null = null;
  let unrealPct: number | null = null;
  if (isOpen && livePrice != null && qty != null) {
    const diff = side === 'SHORT'
      ? order.entryPrice - livePrice
      : livePrice - order.entryPrice;
    unrealPnl = diff * qty;
    unrealPct = (diff / order.entryPrice) * 100;
  }

  const closedPnl = !isOpen && order.pnl != null ? order.pnl : null;

  const lines: string[] = [
    `Phân tích vị thế giao dịch sau:`,
    ``,
    `Symbol: ${order.symbol} | Hướng: ${side} | Trạng thái: ${order.status.toUpperCase()}`,
    `Giá vào: ${formatPrice(order.entryPrice)} | Ngày mở: ${formatDate(order.openedAt)}`,
  ];

  if (order.closePrice != null) {
    lines.push(`Giá đóng: ${formatPrice(order.closePrice)} | Ngày đóng: ${formatDate(order.closedAt)}`);
  }

  if (qty != null) {
    lines.push(`Số lượng: ${qty}${volume != null ? ` | Volume: $${formatPrice(volume)}` : ''}`);
  }

  if (order.leverage != null) {
    lines.push(`Đòn bẩy: ${order.leverage}x`);
  }

  if (isOpen && livePrice != null) {
    const pnlStr = unrealPnl != null
      ? ` | Unreal P/L: ${unrealPnl >= 0 ? '+' : ''}${unrealPnl.toFixed(2)} (${unrealPct != null ? (unrealPct >= 0 ? '+' : '') + unrealPct.toFixed(2) + '%' : ''})`
      : '';
    lines.push(`Giá hiện tại: ${formatPrice(livePrice)}${pnlStr}`);
  }

  if (closedPnl != null) {
    lines.push(`P/L thực tế: ${closedPnl >= 0 ? '+' : ''}${closedPnl.toFixed(2)}`);
  }

  if (order.broker) lines.push(`Source: ${order.broker}`);
  if (order.exchange) lines.push(`Strategy: ${order.exchange}`);
  if (order.orderType) lines.push(`Order Type: ${order.orderType}`);
  if (order.note?.trim()) lines.push(`Ghi chú: ${order.note.trim()}`);

  lines.push(``);
  lines.push(`Dựa trên thông tin trên, hãy:`);
  lines.push(`1. Đánh giá chất lượng điểm vào lệnh (entry)`);
  lines.push(`2. Nhận định về quản lý rủi ro`);
  if (isOpen) {
    lines.push(`3. Đánh giá tình trạng vị thế hiện tại`);
    lines.push(`4. Khuyến nghị: giữ / chốt lời / cắt lỗ / điều chỉnh SL-TP`);
  } else {
    lines.push(`3. Đánh giá kết quả lệnh`);
    lines.push(`4. Bài học rút ra cho các lệnh tương lai`);
  }

  return lines.join('\n');
}

export function TradeAnalyzeDrawer({ order, livePrice, onClose }: Props) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef(false);

  useEffect(() => {
    return () => { pollingRef.current = false; };
  }, []);

  useEffect(() => {
    void initConversation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function pollForReply(convId: string, afterIso: string): Promise<void> {
    const TIMEOUT = 5 * 60 * 1000;
    const start = Date.now();

    while (pollingRef.current && Date.now() - start < TIMEOUT) {
      await new Promise<void>((res) => setTimeout(res, 2000));
      if (!pollingRef.current) break;

      try {
        const msgs = await createApiClient().getMessages(convId);
        const hasReply = msgs.some((m) => m.role === 'assistant' && m.createdAt >= afterIso);
        setMessages(msgs);
        if (hasReply) {
          pollingRef.current = false;
          setLoading(false);
          return;
        }
      } catch { /* ignore transient errors */ }
    }

    pollingRef.current = false;
    setLoading(false);
  }

  async function initConversation() {
    pollingRef.current = false;
    setInitializing(true);
    const api = createApiClient();
    const storageKey = STORAGE_KEY(order.id);
    const cachedId = localStorage.getItem(storageKey);

    if (cachedId) {
      try {
        const existing = await api.getMessages(cachedId);
        setConversationId(cachedId);
        setMessages(existing);
        setInitializing(false);

        const lastMsg = existing[existing.length - 1];
        if (lastMsg?.role === 'user') {
          const age = Date.now() - new Date(lastMsg.createdAt).getTime();
          if (age < 10 * 60 * 1000) {
            setLoading(true);
            pollingRef.current = true;
            void pollForReply(cachedId, lastMsg.createdAt);
          }
        }
        return;
      } catch {
        localStorage.removeItem(storageKey);
      }
    }

    try {
      const conv = await api.createConversation(`Trade Analysis — ${order.symbol}`);
      localStorage.setItem(storageKey, conv.id);
      setConversationId(conv.id);
      setMessages([]);
      setInitializing(false);

      // Auto-send initial analysis prompt
      const prompt = buildInitialPrompt(order, livePrice);
      const sentAt = new Date().toISOString();
      const optimistic: ChatMessage = {
        id: `optimistic-${Date.now()}`,
        conversationId: conv.id,
        role: 'user',
        content: prompt,
        createdAt: sentAt,
      };
      setMessages([optimistic]);
      setLoading(true);

      await api.sendMessage(conv.id, prompt);
      pollingRef.current = true;
      void pollForReply(conv.id, sentAt);
    } catch {
      setInitializing(false);
    }
  }

  async function handleClear() {
    if (!conversationId) return;
    try {
      await createApiClient().deleteConversation(conversationId);
    } catch { /* ignore */ }
    localStorage.removeItem(STORAGE_KEY(order.id));
    setConversationId(null);
    setMessages([]);
    void initConversation();
  }

  async function handleSend() {
    const content = input.trim();
    if (!content || !conversationId || loading) return;

    setInput('');
    const sentAt = new Date().toISOString();
    const optimistic: ChatMessage = {
      id: `optimistic-${Date.now()}`,
      conversationId,
      role: 'user',
      content,
      createdAt: sentAt,
    };
    setMessages((prev) => [...prev, optimistic]);
    setLoading(true);

    try {
      await createApiClient().sendMessage(conversationId, content);
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setLoading(false);
      return;
    }

    pollingRef.current = true;
    void pollForReply(conversationId, sentAt);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  const isOpen = order.status.toLowerCase() === 'open';
  const side = order.side.toUpperCase();

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.4)',
          zIndex: 999,
        }}
      />

      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(480px, 100vw)',
        background: '#ffffff',
        borderLeft: '1px solid #e5e7eb',
        display: 'flex', flexDirection: 'column',
        zIndex: 1000,
        boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
        color: '#111827',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '1rem 1.25rem',
          borderBottom: '1px solid #e5e7eb',
          background: '#f9fafb',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1rem', color: '#111827', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {order.symbol}
              <span style={{
                fontSize: '0.7rem', fontWeight: 600, padding: '0.15rem 0.45rem',
                borderRadius: '4px',
                background: side === 'LONG' ? '#dcfce7' : '#fee2e2',
                color: side === 'LONG' ? '#15803d' : '#dc2626',
              }}>
                {side}
              </span>
              <span style={{
                fontSize: '0.7rem', fontWeight: 500, padding: '0.15rem 0.45rem',
                borderRadius: '4px',
                background: isOpen ? '#dbeafe' : '#f3f4f6',
                color: isOpen ? '#1d4ed8' : '#6b7280',
              }}>
                {isOpen ? 'OPEN' : 'CLOSED'}
              </span>
            </div>
            <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.15rem' }}>
              Entry: {formatPrice(order.entryPrice)}
              {livePrice != null && isOpen && ` → Live: ${formatPrice(livePrice)}`}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <button
              onClick={() => void handleClear()}
              disabled={initializing || messages.length === 0}
              aria-label="New analysis"
              title="Start new analysis"
              style={{
                background: 'none', border: '1px solid #e5e7eb', borderRadius: '6px',
                cursor: 'pointer', color: '#6b7280', fontSize: '0.75rem',
                padding: '0.3rem 0.6rem', lineHeight: 1,
                opacity: initializing || messages.length === 0 ? 0.4 : 1,
              }}
            >
              New
            </button>
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: '#6b7280', fontSize: '1.4rem', lineHeight: 1, padding: '0.25rem',
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', background: '#f9fafb' }}>
          {initializing ? (
            <div style={{ color: '#9ca3af', fontSize: '0.85rem', textAlign: 'center', paddingTop: '2rem' }}>
              Đang khởi tạo…
            </div>
          ) : messages.length === 0 ? (
            <div style={{ color: '#6b7280', fontSize: '0.85rem', textAlign: 'center', paddingTop: '2rem' }}>
              Đang chuẩn bị phân tích…
            </div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === 'user';
              return (
                <div key={msg.id} style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
                  <div style={{
                    maxWidth: '90%',
                    padding: '0.6rem 0.9rem',
                    borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    background: isUser ? '#4f46e5' : '#ffffff',
                    color: isUser ? '#ffffff' : '#111827',
                    border: isUser ? 'none' : '1px solid #e5e7eb',
                    fontSize: '0.875rem',
                    lineHeight: 1.6,
                    wordBreak: 'break-word',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
                  }}>
                    {isUser ? (
                      <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
                    ) : (
                      <span dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
                    )}
                  </div>
                </div>
              );
            })
          )}
          {loading && (
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <div style={{ padding: '0.6rem 0.9rem', background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '16px 16px 16px 4px', boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }}>
                <TypingIndicator />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div style={{
          padding: '0.75rem 1.25rem',
          borderTop: '1px solid #e5e7eb',
          background: '#ffffff',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Hỏi thêm về lệnh này… (Enter để gửi)"
              disabled={loading || initializing || !conversationId}
              rows={2}
              style={{
                flex: 1,
                resize: 'none',
                background: '#f9fafb',
                border: '1px solid #d1d5db',
                borderRadius: '10px',
                padding: '0.6rem 0.75rem',
                color: '#111827',
                fontSize: '0.875rem',
                outline: 'none',
                fontFamily: 'inherit',
                lineHeight: 1.5,
              }}
            />
            <button
              onClick={() => void handleSend()}
              disabled={loading || initializing || !input.trim() || !conversationId}
              style={{
                padding: '0.6rem 1rem',
                background: '#4f46e5',
                color: '#fff',
                border: 'none',
                borderRadius: '10px',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.875rem',
                flexShrink: 0,
                opacity: loading || initializing || !input.trim() ? 0.45 : 1,
              }}
            >
              Gửi
            </button>
          </div>
          <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginTop: '0.35rem' }}>
            Shift+Enter để xuống dòng
          </div>
        </div>
      </div>
    </>
  );
}
