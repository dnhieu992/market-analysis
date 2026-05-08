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
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  useEffect(() => {
    inputRef.current?.focus();
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
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Left Sidebar ──────────────────────────────────────────── */}
      <aside style={{
        width: 260,
        minWidth: 260,
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--background-elevated)',
        overflow: 'hidden'
      }}>
        {/* Back + Skill info */}
        <div style={{ padding: '20px 16px 12px', borderBottom: '1px solid var(--border)' }}>
          <Link
            href="/skills"
            style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}
          >
            ← Tất cả skills
          </Link>
          {skill && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 28 }}>{skill.icon}</span>
              <div>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: 'var(--foreground)' }}>{skill.name}</p>
                <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{skill.category}</p>
              </div>
            </div>
          )}
        </div>

        {/* New conversation button */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <button
            onClick={() => { void handleNewConversation(); }}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'var(--accent-soft)',
              color: 'var(--accent)',
              border: '1px solid var(--accent)',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            + Cuộc trò chuyện mới
          </button>
        </div>

        {/* Conversation list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px' }}>
          {conversations.length === 0 ? (
            <p style={{ padding: '12px 8px', color: 'var(--muted)', fontSize: 13 }}>Chưa có cuộc trò chuyện</p>
          ) : (
            conversations.map((conv) => {
              const isActive = conv.id === conversationId;
              return (
                <Link
                  key={conv.id}
                  href={`/skills/${skillId}/chat/${conv.id}`}
                  style={{
                    display: 'block',
                    padding: '9px 10px',
                    borderRadius: 8,
                    background: isActive ? 'var(--accent-soft)' : 'transparent',
                    color: isActive ? 'var(--accent)' : 'var(--foreground)',
                    fontSize: 13,
                    fontWeight: isActive ? 600 : 400,
                    marginBottom: 2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                  title={conv.title}
                >
                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {conv.title}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>
                    {formatDate(conv.updatedAt)}
                  </span>
                </Link>
              );
            })
          )}
        </div>
      </aside>

      {/* ── Main Chat Area ────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{
          padding: '16px 24px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: 'var(--background-elevated)'
        }}>
          {skill && <span style={{ fontSize: 22 }}>{skill.icon}</span>}
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--foreground)' }}>
            {skill?.name ?? 'Chat'}
          </span>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>

          {/* Welcome + quick actions */}
          {showWelcome && skill && (
            <div style={{ maxWidth: 600, marginBottom: 32 }}>
              <div style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: '16px 20px',
                marginBottom: 16
              }}>
                <p style={{ margin: 0, color: 'var(--foreground)', fontSize: 14, lineHeight: 1.6 }}>
                  {skill.welcomeMessage}
                </p>
              </div>
              {skill.exampleQuestions.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {skill.exampleQuestions.slice(0, 4).map((q) => (
                    <button
                      key={q}
                      onClick={() => handleQuickAction(q)}
                      style={{
                        padding: '7px 14px',
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: 20,
                        fontSize: 13,
                        color: 'var(--foreground)',
                        cursor: 'pointer'
                      }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Message thread */}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`chat-msg chat-msg--${msg.role}`}
            >
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
        <div className="chat-input-area" style={{ padding: '16px 24px' }}>
          <div className="chat-input-wrap">
            <textarea
              ref={inputRef}
              className="chat-input"
              rows={2}
              placeholder={`Hỏi ${skill?.name ?? 'AI'}... (Enter để gửi, Shift+Enter xuống dòng)`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
            />
          </div>
          <button
            className="chat-send-btn"
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
