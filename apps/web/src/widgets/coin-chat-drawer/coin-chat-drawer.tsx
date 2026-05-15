'use client';

import { useEffect, useRef, useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { ChatMessage, Holding } from '@web/shared/api/types';

type Props = Readonly<{
  coinId: string;
  portfolioId: string;
  holding: Holding | null;
  currentPrice: number | null;
  onClose: () => void;
}>;

function renderMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^#{3} (.+)$/gm, '<h3>$1</h3>')
    .replace(/^#{2} (.+)$/gm, '<h2>$1</h2>')
    .replace(/^#{1} (.+)$/gm, '<h1>$1</h1>')
    .replace(/^[-•] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br/>');
}

function TypingIndicator() {
  return <div className="chat-typing"><span /><span /><span /></div>;
}

const STORAGE_KEY = (portfolioId: string, coinId: string) => `coin-chat:${portfolioId}:${coinId}`;

export function CoinChatDrawer({ coinId, portfolioId, holding, currentPrice, onClose }: Props) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void initConversation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coinId, portfolioId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function initConversation() {
    setInitializing(true);
    const api = createApiClient();
    const storageKey = STORAGE_KEY(portfolioId, coinId);
    const cachedId = localStorage.getItem(storageKey);

    if (cachedId) {
      try {
        const existing = await api.getMessages(cachedId);
        setConversationId(cachedId);
        setMessages(existing);
        setInitializing(false);
        return;
      } catch {
        localStorage.removeItem(storageKey);
      }
    }

    try {
      const conv = await api.createConversation(`${coinId} — AI Review`, undefined, coinId, portfolioId);
      localStorage.setItem(storageKey, conv.id);
      setConversationId(conv.id);
      setMessages([]);
    } catch {
      // ignore — user can still see empty state
    }
    setInitializing(false);
  }

  async function handleSend() {
    const content = input.trim();
    if (!content || !conversationId || loading) return;

    setInput('');
    const optimistic: ChatMessage = {
      id: `optimistic-${Date.now()}`,
      conversationId,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setLoading(true);

    try {
      const reply = await createApiClient().sendMessage(conversationId, content);
      setMessages((prev) => [...prev.filter((m) => m.id !== optimistic.id), optimistic, reply]);
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  const totalAmount = holding?.totalAmount ?? 0;
  const avgCost = holding?.avgCost ?? 0;
  const unrealizedPnl = currentPrice != null ? (currentPrice - Number(avgCost)) * Number(totalAmount) : null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.4)',
          zIndex: 999,
        }}
      />

      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(440px, 100vw)',
        background: 'var(--panel-bg, #1a1a2e)',
        borderLeft: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        zIndex: 1000,
        boxShadow: '-4px 0 24px rgba(0,0,0,0.4)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '1rem 1.25rem',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1rem' }}>{coinId} — AI Assistant</div>
            {unrealizedPnl != null && (
              <div style={{ fontSize: '0.75rem', color: unrealizedPnl >= 0 ? '#22c55e' : '#ef4444', marginTop: '0.15rem' }}>
                Unrealized P&L: {unrealizedPnl >= 0 ? '+' : ''}${unrealizedPnl.toFixed(2)}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--muted)', fontSize: '1.4rem', lineHeight: 1, padding: '0.25rem',
            }}
          >
            ✕
          </button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {initializing ? (
            <div style={{ color: 'var(--muted)', fontSize: '0.85rem', textAlign: 'center', paddingTop: '2rem' }}>
              Đang khởi tạo…
            </div>
          ) : messages.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: '0.85rem', textAlign: 'center', paddingTop: '2rem' }}>
              Hỏi bất cứ điều gì về <strong>{coinId}</strong> trong portfolio của bạn.
            </div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === 'user';
              return (
                <div key={msg.id} style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
                  <div style={{
                    maxWidth: '85%',
                    padding: '0.6rem 0.9rem',
                    borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    background: isUser ? 'var(--accent, #6366f1)' : 'rgba(255,255,255,0.06)',
                    color: isUser ? '#fff' : 'inherit',
                    fontSize: '0.875rem',
                    lineHeight: 1.6,
                    wordBreak: 'break-word',
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
              <div style={{ padding: '0.6rem 0.9rem', background: 'rgba(255,255,255,0.06)', borderRadius: '16px 16px 16px 4px' }}>
                <TypingIndicator />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div style={{
          padding: '0.75rem 1.25rem',
          borderTop: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Nhập câu hỏi... (Enter để gửi)"
              disabled={loading || initializing || !conversationId}
              rows={2}
              style={{
                flex: 1,
                resize: 'none',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                padding: '0.6rem 0.75rem',
                color: 'inherit',
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
                background: 'var(--accent, #6366f1)',
                color: '#fff',
                border: 'none',
                borderRadius: '10px',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.875rem',
                flexShrink: 0,
                opacity: loading || initializing || !input.trim() ? 0.5 : 1,
              }}
            >
              Gửi
            </button>
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '0.35rem' }}>
            Shift+Enter để xuống dòng
          </div>
        </div>
      </div>
    </>
  );
}
