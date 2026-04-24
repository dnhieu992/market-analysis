'use client';

import { useEffect, useRef, useState } from 'react';
import { createApiClient } from '@web/shared/api/client';
import type { Conversation, ChatMessage } from '@web/shared/api/types';

// ── Simple markdown renderer ─────────────────────────────────────────
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

// ── Sub-components ────────────────────────────────────────────────────

function BotIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      <line x1="12" y1="3" x2="12" y2="7"/>
      <circle cx="9" cy="16" r="1" fill="currentColor" stroke="none"/>
      <circle cx="15" cy="16" r="1" fill="currentColor" stroke="none"/>
    </svg>
  );
}

function TypingIndicator() {
  return (
    <div className="chat-typing">
      <span/><span/><span/>
    </div>
  );
}

// ── Main Widget ───────────────────────────────────────────────────────

export function ChatbotWidget() {
  const [open, setOpen]         = useState(false);
  const [view, setView]         = useState<'list' | 'chat'>('list');

  // conversations list
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loadingConvs, setLoadingConvs]   = useState(false);

  // active conversation
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages]     = useState<ChatMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  // sending
  const [input, setInput]     = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const bottomRef   = useRef<HTMLDivElement>(null);
  const inputRef    = useRef<HTMLTextAreaElement>(null);
  const api = createApiClient();

  // Load conversations when panel opens
  useEffect(() => {
    if (!open) return;
    setLoadingConvs(true);
    api.listConversations()
      .then(setConversations)
      .catch(() => {/* ignore */})
      .finally(() => setLoadingConvs(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  // Load messages when opening a conversation
  async function openConversation(conv: Conversation) {
    setActiveConv(conv);
    setView('chat');
    setLoadingMsgs(true);
    setMessages([]);
    setError(null);
    try {
      const msgs = await api.getMessages(conv.id);
      setMessages(msgs);
    } catch {
      setError('Không thể tải tin nhắn');
    } finally {
      setLoadingMsgs(false);
    }
    setTimeout(() => inputRef.current?.focus(), 100);
  }

  async function startNewConversation() {
    try {
      const conv = await api.createConversation();
      setConversations((prev) => [conv, ...prev]);
      await openConversation(conv);
    } catch {
      setError('Không thể tạo cuộc trò chuyện');
    }
  }

  async function handleDeleteConv(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    try {
      await api.deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConv?.id === id) {
        setActiveConv(null);
        setView('list');
      }
    } catch {/* ignore */}
  }

  async function handleSend() {
    if (!input.trim() || !activeConv || sending) return;
    const content = input.trim();
    setInput('');
    setError(null);

    // Optimistic user message
    const tempUserMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      conversationId: activeConv.id,
      role: 'user',
      content,
      createdAt: new Date().toISOString()
    };
    setMessages((prev) => [...prev, tempUserMsg]);
    setSending(true);

    try {
      const assistantMsg = await api.sendMessage(activeConv.id, content);
      // Replace temp message with real one from server (it includes the assistant reply)
      const allMsgs = await api.getMessages(activeConv.id);
      setMessages(allMsgs);

      // Update conversation list title
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConv.id
            ? { ...c, title: content.slice(0, 80), updatedAt: assistantMsg.createdAt }
            : c
        )
      );
    } catch {
      setError('Gửi thất bại. Vui lòng thử lại.');
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id));
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  return (
    <>
      {/* Floating button */}
      <button
        className={`chat-fab${open ? ' chat-fab--open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label="Mở trợ lý giao dịch"
      >
        {open ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        ) : (
          <BotIcon />
        )}
      </button>

      {/* Panel */}
      {open && (
        <div className="chat-panel">
          {/* Header */}
          <div className="chat-panel-header">
            {view === 'chat' && activeConv ? (
              <>
                <button className="chat-back-btn" onClick={() => setView('list')} aria-label="Quay lại">
                  ←
                </button>
                <span className="chat-panel-title" title={activeConv.title}>
                  {activeConv.title.length > 35 ? activeConv.title.slice(0, 35) + '…' : activeConv.title}
                </span>
              </>
            ) : (
              <span className="chat-panel-title">Trợ lý giao dịch</span>
            )}
            <button className="chat-new-btn" onClick={startNewConversation} title="Cuộc trò chuyện mới">
              +
            </button>
          </div>

          {/* Body */}
          {view === 'list' ? (
            /* Conversation list */
            <div className="chat-conv-list">
              {loadingConvs ? (
                <p className="chat-empty">Đang tải...</p>
              ) : conversations.length === 0 ? (
                <div className="chat-empty-state">
                  <BotIcon />
                  <p>Chưa có cuộc trò chuyện nào.</p>
                  <button className="chat-start-btn" onClick={startNewConversation}>
                    Bắt đầu trò chuyện
                  </button>
                </div>
              ) : (
                conversations.map((conv) => (
                  <div key={conv.id} className="chat-conv-item" onClick={() => openConversation(conv)}>
                    <div className="chat-conv-item-title">{conv.title}</div>
                    <div className="chat-conv-item-date">{formatDate(conv.updatedAt)}</div>
                    <button
                      className="chat-conv-del"
                      onClick={(e) => handleDeleteConv(e, conv.id)}
                      aria-label="Xoá"
                    >✕</button>
                  </div>
                ))
              )}
            </div>
          ) : (
            /* Chat thread */
            <>
              <div className="chat-messages">
                {loadingMsgs ? (
                  <p className="chat-empty">Đang tải tin nhắn...</p>
                ) : messages.length === 0 ? (
                  <div className="chat-empty-state">
                    <BotIcon />
                    <p>Hãy đặt câu hỏi đầu tiên!</p>
                    <p className="chat-hint">Ví dụ: "Phân tích BTCUSDT khung H1" hoặc "Tôi hay thua ở cặp nào?"</p>
                  </div>
                ) : (
                  messages.map((msg) => (
                    <div key={msg.id} className={`chat-msg chat-msg--${msg.role}`}>
                      {msg.role === 'assistant' && (
                        <div className="chat-msg-avatar"><BotIcon /></div>
                      )}
                      <div className="chat-msg-body">
                        {msg.role === 'assistant' ? (
                          <div
                            className="chat-msg-text"
                            // eslint-disable-next-line react/no-danger
                            dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                          />
                        ) : (
                          <div className="chat-msg-text">{msg.content}</div>
                        )}
                        <span className="chat-msg-time">{formatTime(msg.createdAt)}</span>
                      </div>
                    </div>
                  ))
                )}
                {sending && (
                  <div className="chat-msg chat-msg--assistant">
                    <div className="chat-msg-avatar"><BotIcon /></div>
                    <div className="chat-msg-body"><TypingIndicator /></div>
                  </div>
                )}
                {error && <p className="chat-error">{error}</p>}
                <div ref={bottomRef} />
              </div>

              {/* Input */}
              <div className="chat-input-area">
                <textarea
                  ref={inputRef}
                  className="chat-input"
                  rows={2}
                  placeholder="Nhập câu hỏi... (Enter để gửi, Shift+Enter xuống dòng)"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={sending}
                />
                <button
                  className="chat-send-btn"
                  onClick={() => void handleSend()}
                  disabled={!input.trim() || sending}
                  aria-label="Gửi"
                >
                  {sending ? '…' : '↑'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
