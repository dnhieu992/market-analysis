'use client';

import { useEffect, useRef, useState } from 'react';
import { createApiClient } from '@web/shared/api/client';
import type { Conversation, ChatMessage, TradingStrategy } from '@web/shared/api/types';

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

function HamburgerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="3" y1="6" x2="21" y2="6"/>
      <line x1="3" y1="12" x2="21" y2="12"/>
      <line x1="3" y1="18" x2="21" y2="18"/>
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
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

export function ChatbotWidget({ pinned = false, open: propOpen, onClose }: { pinned?: boolean; open?: boolean; onClose?: () => void }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = pinned && propOpen !== undefined ? propOpen : internalOpen;
  function setOpen(val: boolean | ((v: boolean) => boolean)) {
    const next = typeof val === 'function' ? val(open) : val;
    if (pinned && propOpen !== undefined) { if (!next) onClose?.(); }
    else setInternalOpen(next);
  }
  const [historyOpen, setHistoryOpen] = useState(false);

  // conversations list
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loadingConvs, setLoadingConvs]   = useState(false);

  // active conversation
  const [activeConv, setActiveConv]     = useState<Conversation | null>(null);
  const [messages, setMessages]         = useState<ChatMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs]   = useState(false);

  // sending
  const [input, setInput]     = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // @ mention
  const [strategies, setStrategies]     = useState<TradingStrategy[]>([]);
  const [mentionOpen, setMentionOpen]   = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);
  const api = createApiClient();

  // Load conversations + strategies when panel opens
  useEffect(() => {
    if (!open) return;
    setLoadingConvs(true);
    api.listConversations()
      .then(setConversations)
      .catch(() => {/* ignore */})
      .finally(() => setLoadingConvs(false));
    api.fetchTradingStrategies()
      .then(setStrategies)
      .catch(() => {/* ignore */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  // Close history drawer on outside click
  useEffect(() => {
    if (!historyOpen) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setHistoryOpen(false); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [historyOpen]);

  async function openConversation(conv: Conversation) {
    setActiveConv(conv);
    setHistoryOpen(false);
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
        setMessages([]);
      }
    } catch {/* ignore */}
  }

  async function handleSend() {
    if (!input.trim() || !activeConv || sending) return;
    const content = input.trim();
    setInput('');
    setError(null);

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
      const allMsgs = await api.getMessages(activeConv.id);
      setMessages(allMsgs);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConv.id
            ? { ...c, title: content.slice(0, 80), updatedAt: assistantMsg.createdAt }
            : c
        )
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gửi thất bại. Vui lòng thử lại.';
      setError(msg);
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id));
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  // ── @ mention helpers ──────────────────────────────────────────────

  const filteredStrategies = strategies.filter((s) =>
    s.name.toLowerCase().includes(mentionQuery.toLowerCase())
  );

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    const cursor = e.target.selectionStart ?? val.length;
    setInput(val);
    const match = val.slice(0, cursor).match(/@(\w*)$/);
    if (match) {
      setMentionQuery(match[1] ?? '');
      setMentionOpen(true);
      setMentionIndex(0);
    } else {
      setMentionOpen(false);
    }
  }

  function applyMention(strategy: TradingStrategy) {
    const cursor = inputRef.current?.selectionStart ?? input.length;
    const before = input.slice(0, cursor).replace(/@\w*$/, `@${strategy.name} `);
    const after = input.slice(cursor);
    const next = before + after;
    setInput(next);
    setMentionOpen(false);
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(before.length, before.length);
    }, 0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionOpen && filteredStrategies.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex((i) => Math.min(i + 1, filteredStrategies.length - 1)); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setMentionIndex((i) => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter')     { e.preventDefault(); applyMention(filteredStrategies[mentionIndex]!); return; }
      if (e.key === 'Escape')    { setMentionOpen(false); return; }
    }
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

  const panelTitle = activeConv
    ? (activeConv.title.length > 28 ? activeConv.title.slice(0, 28) + '…' : activeConv.title)
    : 'Trợ lý giao dịch';

  return (
    <>
      {/* Floating button — hidden when pinned */}
      {!pinned && (
        <button
          className={`chat-fab${open ? ' chat-fab--open' : ''}`}
          onClick={() => setOpen((v) => !v)}
          aria-label="Mở trợ lý giao dịch"
        >
          {open ? <CloseIcon /> : <BotIcon />}
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className={`chat-panel${pinned ? ' chat-panel--pinned' : ''}`}>
          {/* Header */}
          <div className="chat-panel-header">
            <button
              className="chat-hamburger-btn"
              onClick={() => setHistoryOpen((v) => !v)}
              aria-label="Lịch sử trò chuyện"
            >
              <HamburgerIcon />
            </button>
            <span className="chat-panel-title" title={activeConv?.title}>{panelTitle}</span>
            <button className="chat-new-btn" onClick={startNewConversation} title="Cuộc trò chuyện mới">+</button>
            <button className="chat-close-btn" onClick={() => setOpen(false)} aria-label="Đóng">
              <CloseIcon />
            </button>
          </div>

          {/* Body */}
          <div className="chat-body">
            {/* History drawer */}
            {historyOpen && (
              <>
                <div className="chat-history-backdrop" onClick={() => setHistoryOpen(false)} />
                <div className="chat-history-drawer">
                  <div className="chat-history-header">Lịch sử</div>
                  {loadingConvs ? (
                    <p className="chat-empty">Đang tải...</p>
                  ) : conversations.length === 0 ? (
                    <p className="chat-empty">Chưa có cuộc trò chuyện</p>
                  ) : (
                    conversations.map((conv) => (
                      <div
                        key={conv.id}
                        className={`chat-conv-item${activeConv?.id === conv.id ? ' chat-conv-item--active' : ''}`}
                        onClick={() => openConversation(conv)}
                      >
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
              </>
            )}

            {/* Messages */}
            <div className="chat-messages">
              {!activeConv ? (
                <div className="chat-empty-state">
                  <BotIcon />
                  <p>Chưa có cuộc trò chuyện nào.</p>
                  <button className="chat-start-btn" onClick={startNewConversation}>
                    Bắt đầu trò chuyện
                  </button>
                </div>
              ) : loadingMsgs ? (
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
          </div>

          {/* Input */}
          <div className="chat-input-area">
            <div className="chat-input-wrap">
              {mentionOpen && filteredStrategies.length > 0 && (
                <div className="chat-mention-list">
                  {filteredStrategies.map((s, i) => (
                    <div
                      key={s.id}
                      className={`chat-mention-item${i === mentionIndex ? ' chat-mention-item--active' : ''}`}
                      onMouseDown={(e) => { e.preventDefault(); applyMention(s); }}
                      onMouseEnter={() => setMentionIndex(i)}
                    >
                      <span className="chat-mention-name">{s.name}</span>
                      <span className="chat-mention-version">v{s.version}</span>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                ref={inputRef}
                className="chat-input"
                rows={2}
                placeholder={activeConv ? 'Nhập câu hỏi... (@ để chọn chiến lược)' : 'Tạo cuộc trò chuyện để bắt đầu'}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                disabled={sending || !activeConv}
              />
            </div>
            <button
              className="chat-send-btn"
              onClick={() => void handleSend()}
              disabled={!input.trim() || sending || !activeConv}
              aria-label="Gửi"
            >
              {sending ? '…' : '↑'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
