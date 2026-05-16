'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createApiClient } from '@web/shared/api/client';
import type { Skill, Conversation, ChatMessage } from '@web/shared/api/types';

import { renderMarkdown } from '@web/shared/lib/markdown';

function TypingIndicator() {
  return <div className="chat-typing"><span /><span /><span /></div>;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}

const api = createApiClient();

// ── Conversation item with rename/delete ───────────────────────────────────────
function ConvItem({
  conv,
  isActive,
  skillId,
  onRenamed,
  onDeleted,
}: {
  conv: Conversation;
  isActive: boolean;
  skillId: string;
  onRenamed: (id: string, title: string) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conv.title);
  const [confirming, setConfirming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  async function submitRename() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === conv.title) { setEditing(false); return; }
    try {
      await api.updateConversationTitle(conv.id, trimmed);
      onRenamed(conv.id, trimmed);
    } catch { /* ignore */ }
    setEditing(false);
  }

  async function confirmDelete() {
    try {
      await api.deleteConversation(conv.id);
      onDeleted(conv.id);
    } catch { /* ignore */ }
  }

  return (
    <div className={`sc-conv-item${isActive ? ' sc-conv-item--active' : ''}`}>
      {editing ? (
        <input
          ref={inputRef}
          className="sc-conv-rename-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { void submitRename(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void submitRename(); }
            if (e.key === 'Escape') { setEditing(false); setDraft(conv.title); }
          }}
        />
      ) : confirming ? (
        <div className="sc-conv-confirm">
          <span>Xóa?</span>
          <button className="sc-conv-confirm-yes" onClick={() => { void confirmDelete(); }}>Có</button>
          <button className="sc-conv-confirm-no" onClick={() => setConfirming(false)}>Không</button>
        </div>
      ) : (
        <>
          <Link href={`/skills/${skillId}/chat/${conv.id}`} className="sc-conv-link" title={conv.title}>
            <span className="sc-conv-title">{conv.title}</span>
            <span className="sc-conv-date">{formatDate(conv.updatedAt)}</span>
          </Link>
          <div className="sc-conv-actions">
            <button
              className="sc-conv-action-btn"
              onClick={() => { setDraft(conv.title); setEditing(true); }}
              title="Đổi tên"
              aria-label="Đổi tên"
            >✏️</button>
            <button
              className="sc-conv-action-btn"
              onClick={() => setConfirming(true)}
              title="Xóa"
              aria-label="Xóa"
            >🗑️</button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Props ──────────────────────────────────────────────────────────────────────
type Props = {
  skillId: string;
  conversationId: string; // 'new' = draft mode
  skill: Skill | null;
  initialConversations: Conversation[];
  initialMessages: ChatMessage[];
};

export function SkillChatClient({
  skillId,
  conversationId,
  skill,
  initialConversations,
  initialMessages,
}: Props) {
  const router = useRouter();
  const isNew = conversationId === 'new';

  const [conversations, setConversations] = useState<Conversation[]>(initialConversations);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pollingRef = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [conversationId]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [conversationId]);

  // Stop polling on unmount
  useEffect(() => {
    return () => { pollingRef.current = false; };
  }, []);

  // Auto-poll when navigating to a conversation with a pending assistant reply
  useEffect(() => {
    if (isNew) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role === 'user' && !pollingRef.current) {
      const age = Date.now() - new Date(lastMsg.createdAt).getTime();
      if (age < 10 * 60 * 1000) {
        setSending(true);
        pollingRef.current = true;
        void pollForReply(conversationId, lastMsg.createdAt);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  function handleNewConversation() {
    router.push(`/skills/${skillId}/chat/new`);
  }

  async function pollForReply(convId: string, afterIso: string): Promise<void> {
    const TIMEOUT = 5 * 60 * 1000;
    const start = Date.now();

    while (pollingRef.current && Date.now() - start < TIMEOUT) {
      await new Promise<void>((res) => setTimeout(res, 2000));
      if (!pollingRef.current) break;

      try {
        const msgs = await api.getMessages(convId);
        const hasReply = msgs.some((m) => m.role === 'assistant' && m.createdAt >= afterIso);
        setMessages(msgs);
        if (hasReply) {
          pollingRef.current = false;
          setSending(false);
          setConversations((prev) =>
            prev.map((c) => c.id === convId ? { ...c, updatedAt: new Date().toISOString() } : c)
          );
          setTimeout(() => inputRef.current?.focus(), 50);
          return;
        }
      } catch { /* ignore transient errors */ }
    }

    pollingRef.current = false;
    setSending(false);
    if (Date.now() - start >= TIMEOUT) {
      setError('Phản hồi AI mất quá nhiều thời gian. Hãy thử làm mới trang.');
    }
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  async function handleSend() {
    if (!input.trim() || sending) return;
    const content = input.trim();
    setInput('');
    setError(null);
    setSending(true);

    if (isNew) {
      // Draft mode: create conversation then send first message
      try {
        const conv = await api.createConversation(skill?.name ?? 'New Chat', skillId);
        setConversations((prev) => [conv, ...prev]);

        const sentAt = new Date().toISOString();
        const tempMsg: ChatMessage = {
          id: `temp-${Date.now()}`,
          conversationId: conv.id,
          role: 'user',
          content,
          createdAt: sentAt,
        };
        setMessages([tempMsg]);

        // sendMessage now returns fast (user msg saved, LLM runs in background)
        await api.sendMessage(conv.id, content);

        // Generate AI title in background
        api.generateTitle(conv.id)
          .then(({ title }) => {
            setConversations((prev) => prev.map((c) => c.id === conv.id ? { ...c, title } : c));
          })
          .catch(() => { /* ignore */ });

        // Navigate — server component fetches initial messages, auto-poll kicks in
        router.replace(`/skills/${skillId}/chat/${conv.id}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gửi thất bại. Vui lòng thử lại.';
        setError(msg);
        setMessages([]);
        setSending(false);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      return;
    }

    // Existing conversation — add optimistic user message, send, then poll for reply
    const sentAt = new Date().toISOString();
    const tempMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      conversationId,
      role: 'user',
      content,
      createdAt: sentAt,
    };
    setMessages((prev) => [...prev, tempMsg]);

    try {
      // sendMessage returns fast (user msg saved, LLM runs in background)
      await api.sendMessage(conversationId, content);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gửi thất bại. Vui lòng thử lại.';
      setError(msg);
      setMessages((prev) => prev.filter((m) => m.id !== tempMsg.id));
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 50);
      return;
    }

    // Poll until assistant reply arrives
    pollingRef.current = true;
    await pollForReply(conversationId, sentAt);
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

      {/* Backdrop (mobile) */}
      <div
        className={`sc-sidebar-backdrop${sidebarOpen ? ' sc-sidebar-backdrop--open' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar */}
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
          <button className="sc-new-btn" onClick={handleNewConversation}>
            + Cuộc trò chuyện mới
          </button>
        </div>

        <div className="sc-conv-list">
          {conversations.length === 0 ? (
            <p className="sc-conv-empty">Chưa có cuộc trò chuyện</p>
          ) : (
            conversations.map((conv) => (
              <ConvItem
                key={conv.id}
                conv={conv}
                isActive={conv.id === conversationId}
                skillId={skillId}
                onRenamed={(id, title) =>
                  setConversations((prev) => prev.map((c) => c.id === id ? { ...c, title } : c))
                }
                onDeleted={(id) => {
                  setConversations((prev) => prev.filter((c) => c.id !== id));
                  if (id === conversationId) router.push(`/skills/${skillId}/chat/new`);
                }}
              />
            ))
          )}
        </div>
      </aside>

      {/* Main chat */}
      <div className="sc-main">

        {/* Header */}
        <div className="sc-header">
          <button className="sc-header-menu-btn" onClick={() => setSidebarOpen(true)} aria-label="Mở menu">☰</button>
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
                <div className="chat-msg-avatar" style={{ fontSize: 18 }}>{skill?.icon ?? '🤖'}</div>
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

          {error && <p style={{ color: '#e53e3e', fontSize: 13, margin: '8px 0' }}>{error}</p>}

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
