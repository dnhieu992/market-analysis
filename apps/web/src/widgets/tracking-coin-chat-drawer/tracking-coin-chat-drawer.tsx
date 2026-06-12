'use client';

import { useEffect, useRef, useState } from 'react';
import { createApiClient } from '@web/shared/api/client';
import { renderMarkdown } from '@web/shared/lib/markdown';
import type { ChatMessage } from '@web/shared/api/types';
import type { TrackingCoinRow } from '@web/shared/api/types';

type Props = {
  coin: TrackingCoinRow;
  livePrice: number | null;
  onClose: () => void;
};

function TypingIndicator() {
  return <div className="chat-typing"><span /><span /><span /></div>;
}

const STORAGE_KEY = (symbol: string) => `tracking-coin-chat:${symbol}`;

function buildInitialPrompt(coin: TrackingCoinRow, livePrice: number | null): string {
  const sig = coin.signal;
  const name = coin.name ? `${coin.symbol} (${coin.name})` : coin.symbol;

  const lines: string[] = [
    `Hãy phân tích kỹ thuật coin ${name} dựa trên các chỉ báo hiện tại:`,
    ``,
  ];

  if (livePrice != null) {
    lines.push(`Giá hiện tại: $${livePrice.toLocaleString('en-US', { maximumFractionDigits: 6 })}`);
  }

  if (sig) {
    const trendLabel = (t: string) => ({ StrongUp: '↑↑ Strong Up', Up: '↑ Up', Neutral: '→ Neutral', Down: '↓ Down', StrongDown: '↓↓ Strong Down' }[t] ?? t);
    const boolLabel = (v: boolean | null) => v === null ? 'N/A' : v ? 'Yes' : 'No';

    lines.push(``);
    lines.push(`**Price Action Trend:**`);
    lines.push(`- D1: ${trendLabel(sig.trend)}`);
    lines.push(`- H4: ${trendLabel(sig.h4Trend)}`);
    lines.push(`- M30: ${trendLabel(sig.m30Trend)}`);
    lines.push(`- Swing Structure: ${sig.swingStructure}`);

    lines.push(``);
    lines.push(`**UT Bot (ATR=1, Key=3):**`);
    lines.push(`- D1: ${sig.utBotD1Bullish === null ? 'N/A' : sig.utBotD1Bullish ? 'Bullish' : 'Bearish'}`);
    lines.push(`- H4: ${sig.utBotH4Bullish === null ? 'N/A' : sig.utBotH4Bullish ? 'Bullish' : 'Bearish'}`);

    lines.push(``);
    lines.push(`**EMA (giá so với EMA):**`);
    lines.push(`- D1: EMA34 ${boolLabel(sig.ema34Above)}, EMA89 ${boolLabel(sig.ema89Above)}, EMA200 ${boolLabel(sig.ema200Above)}`);
    lines.push(`- H4: EMA34 ${boolLabel(sig.h4Ema34Above)}, EMA89 ${boolLabel(sig.h4Ema89Above)}, EMA200 ${boolLabel(sig.h4Ema200Above)}`);

    lines.push(``);
    lines.push(`**RSI (14):**`);
    lines.push(`- D1: ${sig.rsi != null ? sig.rsi.toFixed(1) : 'N/A'}`);
    lines.push(`- H4: ${sig.h4Rsi != null ? sig.h4Rsi.toFixed(1) : 'N/A'}`);

    lines.push(``);
    lines.push(`**Volume Ratio (so với MA20):**`);
    lines.push(`- D1: ${sig.volMultiplier != null ? sig.volMultiplier.toFixed(2) + 'x' : 'N/A'}`);
    lines.push(`- H4: ${sig.h4VolMultiplier != null ? sig.h4VolMultiplier.toFixed(2) + 'x' : 'N/A'}`);

    lines.push(``);
    lines.push(`Dữ liệu scan lúc: ${new Date(sig.scannedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`);
  }

  lines.push(``, `---`, ``);
  lines.push(`Dựa trên các chỉ báo trên, hãy:`);
  lines.push(`1. Đánh giá xu hướng tổng thể (bullish / bearish / neutral) và độ mạnh của xu hướng`);
  lines.push(`2. Phân tích sự đồng thuận/phân kỳ giữa D1 và H4`);
  lines.push(`3. Xác định các vùng giá quan trọng (support/resistance) cần chú ý`);
  lines.push(`4. Đưa ra khuyến nghị: nên watch để long / short / tránh / chờ xác nhận thêm`);

  return lines.join('\n');
}

export function TrackingCoinChatDrawer({ coin, livePrice, onClose }: Props) {
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
  }, [coin.symbol]);

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
        if (hasReply) { pollingRef.current = false; setLoading(false); return; }
      } catch { /* ignore */ }
    }
    pollingRef.current = false;
    setLoading(false);
  }

  async function initConversation() {
    pollingRef.current = false;
    setInitializing(true);
    const api = createApiClient();
    const storageKey = STORAGE_KEY(coin.symbol);
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
      const conv = await api.createConversation(`${coin.symbol} — Market Analysis`);
      localStorage.setItem(storageKey, conv.id);
      setConversationId(conv.id);
      setMessages([]);
      setInitializing(false);

      const prompt = buildInitialPrompt(coin, livePrice);
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
    try { await createApiClient().deleteConversation(conversationId); } catch { /* ignore */ }
    localStorage.removeItem(STORAGE_KEY(coin.symbol));
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
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); }
  }

  const sig = coin.signal;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 999 }} />

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
              {coin.symbol}
              {coin.name && <span style={{ fontSize: '0.78rem', fontWeight: 400, color: '#6b7280' }}>{coin.name}</span>}
              <span style={{
                fontSize: '0.7rem', fontWeight: 600, padding: '0.15rem 0.45rem',
                borderRadius: '4px', background: '#ede9fe', color: '#6d28d9',
              }}>AI</span>
            </div>
            <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.15rem', display: 'flex', gap: '0.75rem' }}>
              {livePrice != null && <span>Live: ${livePrice.toLocaleString('en-US', { maximumFractionDigits: 4 })}</span>}
              {sig && (
                <span>
                  D1 {sig.trend === 'StrongUp' ? '↑↑' : sig.trend === 'Up' ? '↑' : sig.trend === 'Neutral' ? '→' : sig.trend === 'Down' ? '↓' : '↓↓'}
                  {' · '}
                  H4 {sig.h4Trend === 'StrongUp' ? '↑↑' : sig.h4Trend === 'Up' ? '↑' : sig.h4Trend === 'Neutral' ? '→' : sig.h4Trend === 'Down' ? '↓' : '↓↓'}
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <button
              onClick={() => void handleClear()}
              disabled={initializing || messages.length === 0}
              title="Phân tích mới"
              style={{
                background: 'none', border: '1px solid #e5e7eb', borderRadius: '6px',
                cursor: 'pointer', color: '#6b7280', fontSize: '0.75rem',
                padding: '0.3rem 0.6rem', lineHeight: 1,
                opacity: initializing || messages.length === 0 ? 0.4 : 1,
              }}
            >
              New
            </button>
            <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: '1.4rem', lineHeight: 1, padding: '0.25rem' }}>
              ✕
            </button>
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', background: '#f9fafb' }}>
          {initializing ? (
            <div style={{ color: '#9ca3af', fontSize: '0.85rem', textAlign: 'center', paddingTop: '2rem' }}>Đang khởi tạo…</div>
          ) : messages.length === 0 ? (
            <div style={{ color: '#6b7280', fontSize: '0.85rem', textAlign: 'center', paddingTop: '2rem' }}>Đang chuẩn bị phân tích…</div>
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
        <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid #e5e7eb', background: '#ffffff', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Hỏi thêm về coin này… (Enter để gửi)"
              disabled={loading || initializing || !conversationId}
              rows={2}
              style={{
                flex: 1, resize: 'none',
                background: '#f9fafb', border: '1px solid #d1d5db', borderRadius: '10px',
                padding: '0.6rem 0.75rem', color: '#111827',
                fontSize: '0.875rem', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5,
              }}
            />
            <button
              onClick={() => void handleSend()}
              disabled={loading || initializing || !input.trim() || !conversationId}
              style={{
                padding: '0.6rem 1rem', background: '#4f46e5', color: '#fff',
                border: 'none', borderRadius: '10px', cursor: 'pointer',
                fontWeight: 600, fontSize: '0.875rem', flexShrink: 0,
                opacity: loading || initializing || !input.trim() ? 0.45 : 1,
              }}
            >
              Gửi
            </button>
          </div>
          <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginTop: '0.35rem' }}>Shift+Enter để xuống dòng</div>
        </div>
      </div>
    </>
  );
}
