'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createApiClient } from '@web/shared/api/client';
import type { Skill, Conversation, ChatMessage } from '@web/shared/api/types';

// ── Markdown renderer ─────────────────────────────────────────────────
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
  return (
    <div className="chat-typing">
      <span /><span /><span />
    </div>
  );
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}

const api = createApiClient();

// ── Props ─────────────────────────────────────────────────────────────
type Props = {
  skillId: string;
  conversationId: string;
  skill: Skill | null;
  initialConversations: Conversation[];
  initialMessages: ChatMessage[];
};

export function SkillChatClient({
  skillId,
  conversationId,
  skill,
  initialConversations,
  initialMessages
}: Props) {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>(initialConversations);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [conversationId]);

  // Close sidebar when navigating to a new conversation
  useEffect(() => {
    setSidebarOpen(false);
  }, [conversationId]);

  async function handleNewConversation() {
    try {
      const conv = await api.createConversation(skill?.name, skillId);
      setConversations((prev) => [conv, ...prev]);
      router.push(`/skills/${skillId}/chat/${conv.id}`);
    } catch {
      setError('Không thể tạo cuộc trò chuyện mới');
    }
  }

  async function handleSend() {
    if (!input.trim() || sending) return;
    const content = input.trim();
    setInput('');
    setError(null);

    const tempMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      conversationId,
      role: 'user',
      content,
      createdAt: new Date().toISOString()
    };
    setMessages((prev) => [...prev, tempMsg]);
    setSending(true);

    try {
      await api.sendMessage(conversationId, content);
      const allMsgs = await api.getMessages(conversationId);
      setMessages(allMsgs);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? { ...c, title: content.slice(0, 80), updatedAt: new Date().toISOString() }
            : c
        )
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gửi thất bại. Vui lòng thử lại.';
      setError(msg);
      setMessages((prev) => prev.filter((m) => m.id !== tempMsg.id));
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

  function handleQuickAction(question: string) {
    setInput(question);
    inputRef.current?.focus();
  }

  const showWelcome = messages.length === 0 && !sending;

  return (
    <div className="sc-root">

      {/* ── Backdrop (mobile only) ─────────────────────────────── */}
      <div
        className={`sc-sidebar-backdrop${sidebarOpen ? ' sc-sidebar-backdrop--open' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* ── Sidebar ───────────────────────────────────────────── */}
      <aside className={`sc-sidebar${sidebarOpen ? ' sc-sidebar--open' : ''}`}>
        <div className="sc-sidebar-head">
          <button className="sc-sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Đóng">✕</button>
          <Link href="/skills" className="sc-back-link">← Tất cả skills</Link>
          {skill && (
            <div className="sc-skill-info">
              <span className="sc-skill-icon">{skill.icon}</span>
              <div>
                <p className="sc-skill-name">{skill.name}</p>
                <p className="sc-skill-cat">{skill.category}</p>
              </div>
            </div>
          )}
        </div>

        <div className="sc-new-btn-wrap">
          <button className="sc-new-btn" onClick={() => { void handleNewConversation(); }}>
            + Cuộc trò chuyện mới
          </button>
        </div>

        <div className="sc-conv-list">
          {conversations.length === 0 ? (
            <p className="sc-conv-empty">Chưa có cuộc trò chuyện</p>
          ) : (
            conversations.map((conv) => {
              const isActive = conv.id === conversationId;
              return (
                <Link
                  key={conv.id}
                  href={`/skills/${skillId}/chat/${conv.id}`}
                  className={`sc-conv-item${isActive ? ' sc-conv-item--active' : ''}`}
                  title={conv.title}
                >
                  <span className="sc-conv-title">{conv.title}</span>
                  <span className="sc-conv-date">{formatDate(conv.updatedAt)}</span>
                </Link>
              );
            })
          )}
        </div>
      </aside>

      {/* ── Main Chat Area ────────────────────────────────────── */}
      <div className="sc-main">

        {/* Header */}
        <div className="sc-header">
          <button
            className="sc-header-menu-btn"
            onClick={() => setSidebarOpen(true)}
            aria-label="Mở menu"
          >
            ☰
          </button>
          {skill && <span className="sc-header-icon">{skill.icon}</span>}
          <span className="sc-header-title">{skill?.name ?? 'Chat'}</span>
        </div>

        {/* Messages */}
        <div className="sc-messages">

          {showWelcome && skill && (
            <div className="sc-welcome">
              <div className="sc-welcome-msg">{skill.welcomeMessage}</div>
              {skill.exampleQuestions.length > 0 && (
                <div className="sc-quick-actions">
                  {skill.exampleQuestions.slice(0, 4).map((q) => (
                    <button key={q} className="sc-quick-btn" onClick={() => handleQuickAction(q)}>
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={`chat-msg chat-msg--${msg.role}`}>
              {msg.role === 'assistant' && (
                <div className="chat-msg-avatar" style={{ fontSize: 18 }}>
                  {skill?.icon ?? '🤖'}
                </div>
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
          ))}

          {sending && (
            <div className="chat-msg chat-msg--assistant">
              <div className="chat-msg-avatar" style={{ fontSize: 18 }}>{skill?.icon ?? '🤖'}</div>
              <div className="chat-msg-body"><TypingIndicator /></div>
            </div>
          )}

          {error && (
            <p style={{ color: '#e53e3e', fontSize: 13, margin: '8px 0' }}>{error}</p>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="sc-input-area">
          <div className="sc-input-wrap">
            <textarea
              ref={inputRef}
              className="sc-input"
              rows={2}
              placeholder={`Hỏi ${skill?.name ?? 'AI'}...`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
            />
          </div>
          <button
            className="sc-send-btn"
            onClick={() => void handleSend()}
            disabled={!input.trim() || sending}
            aria-label="Gửi"
          >
            {sending ? '…' : '↑'}
          </button>
        </div>
      </div>
    </div>
  );
}
