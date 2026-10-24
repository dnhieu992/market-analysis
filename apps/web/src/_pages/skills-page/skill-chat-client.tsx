'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createApiClient } from '@web/shared/api/client';
import type { ChatMessage, Conversation, LiveReply, Skill, SkillTradeSetup } from '@web/shared/api/types';

import { renderChatMarkdown } from './chat-markdown';
import styles from './skill-chat.module.css';
import { TradeSetupCard } from './trade-setup-card';

const api = createApiClient();

/** What the UI says while a tool runs — the reply itself streams in once Claude starts writing. */
const TOOL_LABEL: Record<string, string> = {
  get_scalp_chart_data: 'Đang lấy nến 30m / 15m / 5m',
  analyze_market_structure: 'Đang phân tích cấu trúc thị trường',
  get_klines: 'Đang lấy dữ liệu nến',
  get_ticker_price: 'Đang lấy giá hiện tại',
  get_24h_ticker: 'Đang lấy thống kê 24h',
  propose_trade_setup: 'Đang tạo setup lệnh',
  get_tracking_coins: 'Đang đọc danh sách coin theo dõi',
};

const NEW_TITLE = 'Cuộc trò chuyện mới';
const RESUME_WINDOW_MS = 10 * 60 * 1000;
const POLL_MS = 600;
const WATCH_TIMEOUT_MS = 6 * 60 * 1000;
const RAIL_PREF_KEY = 'skillChat.railCollapsed';

type Status = 'idle' | 'waiting' | 'stopping' | 'error' | 'stopped';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

/** Sidebar buckets, like Claude: Hôm nay / Hôm qua / 7 ngày qua / 30 ngày qua / Cũ hơn. */
function groupConversations(convs: Conversation[]): Array<{ label: string; items: Conversation[] }> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const t = startOfToday.getTime();
  const buckets: Array<{ label: string; from: number; items: Conversation[] }> = [
    { label: 'Hôm nay', from: t, items: [] },
    { label: 'Hôm qua', from: t - 864e5, items: [] },
    { label: '7 ngày qua', from: t - 7 * 864e5, items: [] },
    { label: '30 ngày qua', from: t - 30 * 864e5, items: [] },
    { label: 'Cũ hơn', from: -Infinity, items: [] },
  ];
  const sorted = [...convs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const c of sorted) {
    const ts = new Date(c.updatedAt).getTime();
    buckets.find((b) => ts >= b.from)!.items.push(c);
  }
  return buckets.filter((b) => b.items.length > 0);
}

// ── Icons ────────────────────────────────────────────────────────────────────

const Icon = {
  send: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  ),
  stop: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="3" />
    </svg>
  ),
  panel: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M9 4v16" />
    </svg>
  ),
  compose: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  ),
  copy: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  ),
  check: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12l5 5L20 7" />
    </svg>
  ),
  down: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 5v14M5 12l7 7 7-7" />
    </svg>
  ),
  edit: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  ),
  trash: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
    </svg>
  ),
  retry: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  ),
};

// ── Conversation rail ────────────────────────────────────────────────────────

function ConvItem({
  conv,
  active,
  skillId,
  onRenamed,
  onDeleted,
}: {
  conv: Conversation;
  active: boolean;
  skillId: string;
  onRenamed: (id: string, title: string) => void;
  onDeleted: (id: string) => void;
}) {
  const [mode, setMode] = useState<'view' | 'rename' | 'confirm'>('view');
  const [draft, setDraft] = useState(conv.title);

  async function submitRename() {
    const title = draft.trim();
    setMode('view');
    if (!title || title === conv.title) return;
    try {
      await api.updateConversationTitle(conv.id, title);
      onRenamed(conv.id, title);
    } catch {
      /* keep the old title */
    }
  }

  async function confirmDelete() {
    try {
      await api.deleteConversation(conv.id);
      onDeleted(conv.id);
    } catch {
      setMode('view');
    }
  }

  return (
    <div className={`${styles.convItem} ${active ? styles.convItemActive : ''}`}>
      {mode === 'rename' ? (
        <input
          className={styles.renameInput}
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { void submitRename(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void submitRename(); }
            if (e.key === 'Escape') { setDraft(conv.title); setMode('view'); }
          }}
        />
      ) : mode === 'confirm' ? (
        <div className={styles.confirmRow}>
          <span>Xoá cuộc trò chuyện?</span>
          <button type="button" className={styles.confirmYes} onClick={() => { void confirmDelete(); }}>Xoá</button>
          <button type="button" className={styles.confirmNo} onClick={() => setMode('view')}>Huỷ</button>
        </div>
      ) : (
        <>
          <Link href={`/skills/${skillId}/chat/${conv.id}`} className={styles.convLink} title={conv.title}>
            {conv.title}
          </Link>
          <div className={styles.convActions}>
            <button type="button" className={styles.iconBtn} title="Đổi tên" aria-label="Đổi tên" onClick={() => { setDraft(conv.title); setMode('rename'); }}>
              {Icon.edit}
            </button>
            <button type="button" className={styles.iconBtn} title="Xoá" aria-label="Xoá" onClick={() => setMode('confirm')}>
              {Icon.trash}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Messages ─────────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={styles.metaBtn}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? Icon.check : Icon.copy}
      {copied ? 'Đã copy' : 'Copy'}
    </button>
  );
}

function Markdown({ text }: { text: string }) {
  const html = useMemo(() => renderChatMarkdown(text), [text]);
  // eslint-disable-next-line react/no-danger
  return <div className={styles.prose} dangerouslySetInnerHTML={{ __html: html }} />;
}

function UserMessage({ msg }: { msg: ChatMessage }) {
  return (
    <div className={styles.userRow}>
      <div className={styles.userBubble}>{msg.content}</div>
      <div className={styles.msgMeta}>
        <span className={styles.metaTime}>{fmtTime(msg.createdAt)}</span>
        <CopyButton text={msg.content} />
      </div>
    </div>
  );
}

function AssistantMessage({
  msg,
  icon,
  isLast,
  onSetupChange,
}: {
  msg: ChatMessage;
  icon: string;
  isLast: boolean;
  onSetupChange: (s: SkillTradeSetup) => void;
}) {
  return (
    <div className={styles.assistantRow}>
      <div className={styles.avatar}>{icon}</div>
      <div className={styles.assistantBody}>
        <Markdown text={msg.content} />
        {msg.setups && msg.setups.length > 0 && (
          <div className="tsc-list">
            {msg.setups.map((s) => (
              <TradeSetupCard key={s.id} setup={s} onChange={onSetupChange} />
            ))}
          </div>
        )}
        <div className={`${styles.msgMeta} ${isLast ? styles.msgMetaVisible : ''}`}>
          <CopyButton text={msg.content} />
          <span className={styles.metaTime}>{fmtTime(msg.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}

/** The reply being generated: tool status, then the text streaming in with a caret. */
function LiveMessage({ icon, live, startedAt, stopping }: { icon: string; live: LiveReply | null; startedAt: number; stopping: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsed = Math.max(0, Math.round((now - startedAt) / 1000));
  const writing = live?.phase === 'writing' && live.text.trim().length > 0;
  const label = stopping
    ? 'Đang dừng…'
    : live?.phase === 'tool' && live.tool
      ? TOOL_LABEL[live.tool] ?? `Đang chạy ${live.tool}`
      : 'Đang suy nghĩ';

  return (
    <div className={styles.assistantRow}>
      <div className={styles.avatar}>{icon}</div>
      <div className={styles.assistantBody}>
        {writing ? (
          <div>
            <Markdown text={live!.text} />
            <span className={styles.caret} aria-hidden />
          </div>
        ) : (
          <div className={styles.status} role="status" aria-live="polite">
            <span className={styles.spinner} aria-hidden />
            <span>{label}…</span>
            <span className={styles.statusElapsed}>{elapsed}s</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Composer ─────────────────────────────────────────────────────────────────

function Composer({
  value,
  onChange,
  onSend,
  onStop,
  busy,
  placeholder,
  autoFocus,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  placeholder: string;
  autoFocus?: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement>;
}) {
  // Grow with the text up to the CSS max-height, then scroll inside.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value, inputRef]);

  const canSend = value.trim().length > 0 && !busy;

  return (
    <div className={styles.composer} onClick={() => inputRef.current?.focus()}>
      <textarea
        ref={inputRef}
        className={styles.textarea}
        rows={1}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // isComposing: Enter that confirms a Vietnamese (Telex/VNI) composition must not send.
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (canSend) onSend();
          }
          if (e.key === 'Escape' && busy) onStop();
        }}
      />
      <div className={styles.composerBar}>
        <span className={styles.composerHint}>
          {busy ? 'Esc để dừng' : 'Enter để gửi · Shift + Enter xuống dòng'}
        </span>
        {busy ? (
          <button type="button" className={`${styles.sendBtn} ${styles.stopBtn}`} onClick={onStop} title="Dừng (Esc)" aria-label="Dừng">
            {Icon.stop}
          </button>
        ) : (
          <button type="button" className={styles.sendBtn} onClick={onSend} disabled={!canSend} title="Gửi (Enter)" aria-label="Gửi">
            {Icon.send}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

type Props = {
  skillId: string;
  conversationId: string; // 'new' = draft mode
  skill: Skill | null;
  initialConversations: Conversation[];
  initialMessages: ChatMessage[];
};

export function SkillChatClient({ skillId, conversationId, skill, initialConversations, initialMessages }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isNew = conversationId === 'new';
  const icon = skill?.icon ?? '🤖';

  const [conversations, setConversations] = useState<Conversation[]>(initialConversations);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState(() => searchParams?.get('q') ?? '');
  const [status, setStatus] = useState<Status>('idle');
  const [live, setLive] = useState<LiveReply | null>(null);
  const [liveStartedAt, setLiveStartedAt] = useState(Date.now());
  const [notice, setNotice] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(false); // mobile drawer
  const [railCollapsed, setRailCollapsed] = useState(false); // desktop preference
  const [query, setQuery] = useState('');
  const [atBottom, setAtBottom] = useState(true);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const watchGen = useRef(0);

  const busy = status === 'waiting' || status === 'stopping';
  const activeConvId = isNew ? null : conversationId;

  useEffect(() => {
    try {
      setRailCollapsed(localStorage.getItem(RAIL_PREF_KEY) === '1');
    } catch {
      /* storage unavailable — keep the rail open */
    }
    return () => {
      watchGen.current += 1; // stop any reply watcher on unmount
    };
  }, []);

  // ── Scrolling: follow new content only while the reader is at the bottom ──
  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    atBottomRef.current = near;
    setAtBottom(near);
  }, []);

  useLayoutEffect(() => {
    if (atBottomRef.current) scrollToBottom();
  }, [messages, live?.text, live?.phase, status, scrollToBottom]);

  // ── Watching a reply: poll its live progress, then load the saved message ──
  const watchReply = useCallback(async (convId: string, sinceIso: string) => {
    const gen = ++watchGen.current;
    const started = Date.now();
    setStatus('waiting');
    setLive(null);
    setNotice(null);
    let idle = 0;

    while (watchGen.current === gen) {
      let l: LiveReply | null = null;
      try {
        l = await api.getLiveReply(convId);
      } catch {
        /* transient — try again */
      }
      if (watchGen.current !== gen) return;

      if (l?.active) {
        idle = 0;
        setLive(l);
        await sleep(POLL_MS);
        continue;
      }

      try {
        const msgs = await api.getMessages(convId);
        if (watchGen.current !== gen) return;
        setMessages(msgs);
        if (msgs.some((m) => m.role === 'assistant' && m.createdAt >= sinceIso)) {
          setLive(null);
          setStatus('idle');
          setTimeout(() => inputRef.current?.focus(), 30);
          // Picks up the generated title and the new updatedAt order.
          api.listConversations(skillId).then(setConversations).catch(() => {});
          return;
        }
      } catch {
        /* transient */
      }

      if (l?.phase === 'error') {
        setLive(null);
        setStatus('error');
        setNotice(l.error ?? 'Claude gặp lỗi khi trả lời.');
        return;
      }
      if (l?.phase === 'stopped') {
        setLive(null);
        setStatus('stopped');
        return;
      }
      // 'idle' with no reply: the job is gone (e.g. the API restarted) — offer a retry.
      if (l?.phase === 'idle' && ++idle >= 3) {
        setLive(null);
        setStatus('error');
        setNotice('Không còn phiên trả lời cho tin nhắn này (server có thể vừa khởi động lại).');
        return;
      }
      if (Date.now() - started > WATCH_TIMEOUT_MS) {
        setLive(null);
        setStatus('error');
        setNotice('Chờ quá lâu mà chưa có phản hồi.');
        return;
      }
      await sleep(POLL_MS);
    }
  }, [skillId]);

  // Resume when opening a conversation whose last message is still waiting for a reply.
  useEffect(() => {
    if (isNew) return;
    const last = initialMessages[initialMessages.length - 1];
    if (last?.role === 'user' && Date.now() - new Date(last.createdAt).getTime() < RESUME_WINDOW_MS) {
      setLiveStartedAt(new Date(last.createdAt).getTime());
      void watchReply(conversationId, last.createdAt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep accepted setups' trade status fresh while any of them is still pending/open.
  useEffect(() => {
    if (isNew || busy) return;
    const tracking = messages.some((m) => m.setups?.some((s) => s.trade && (s.trade.status === 'PENDING' || s.trade.status === 'OPEN')));
    if (!tracking) return;
    const id = setInterval(() => {
      api.getMessages(conversationId).then(setMessages).catch(() => {});
    }, 30_000);
    return () => clearInterval(id);
  }, [messages, busy, isNew, conversationId]);

  // ── Actions ──
  async function send(textArg?: string) {
    const content = (textArg ?? input).trim();
    if (!content || busy) return;
    setInput('');
    setNotice(null);
    atBottomRef.current = true;

    const temp: ChatMessage = {
      id: `temp-${Date.now()}`,
      conversationId: activeConvId ?? 'new',
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, temp]);
    setLiveStartedAt(Date.now());
    setLive(null);
    setStatus('waiting');

    try {
      if (!activeConvId) {
        // Draft: create the conversation, send, then move to its URL (the page resumes watching).
        const conv = await api.createConversation(content.slice(0, 80), skillId);
        await api.sendMessage(conv.id, content);
        api.generateTitle(conv.id).catch(() => {});
        router.replace(`/skills/${skillId}/chat/${conv.id}`);
        return;
      }
      const saved = await api.sendMessage(activeConvId, content);
      setMessages((prev) => prev.map((m) => (m.id === temp.id ? saved : m)));
      setConversations((prev) => prev.map((c) => (c.id === activeConvId ? { ...c, updatedAt: new Date().toISOString() } : c)));
      await watchReply(activeConvId, saved.createdAt);
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== temp.id));
      setInput(content);
      setStatus('idle');
      setNotice(e instanceof Error ? e.message : 'Gửi thất bại. Vui lòng thử lại.');
    }
  }

  async function stop() {
    if (!activeConvId || status !== 'waiting') return;
    setStatus('stopping');
    try {
      await api.stopReply(activeConvId);
    } catch {
      setStatus('waiting');
    }
  }

  async function retry() {
    if (!activeConvId) return;
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    setNotice(null);
    setLiveStartedAt(Date.now());
    try {
      await api.retryReply(activeConvId);
      await watchReply(activeConvId, lastUser.createdAt);
    } catch (e) {
      setStatus('error');
      setNotice(e instanceof Error ? e.message : 'Không thử lại được.');
    }
  }

  function handleSetupChange(updated: SkillTradeSetup) {
    setMessages((prev) =>
      prev.map((m) =>
        m.setups?.some((s) => s.id === updated.id)
          ? { ...m, setups: m.setups.map((s) => (s.id === updated.id ? updated : s)) }
          : m,
      ),
    );
  }

  function newChat() {
    setRailOpen(false);
    if (isNew) {
      inputRef.current?.focus();
      return;
    }
    router.push(`/skills/${skillId}/chat/new`);
  }

  function toggleRail() {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1100px)').matches) {
      setRailOpen((o) => !o);
      return;
    }
    setRailCollapsed((c) => {
      try {
        localStorage.setItem(RAIL_PREF_KEY, c ? '0' : '1');
      } catch {
        /* preference just won't persist */
      }
      return !c;
    });
  }

  // Cmd/Ctrl + Shift + O starts a new chat, like Claude.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        newChat();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const filtered = query.trim()
    ? conversations.filter((c) => c.title.toLowerCase().includes(query.trim().toLowerCase()))
    : conversations;
  const groups = groupConversations(filtered);
  const title = isNew ? NEW_TITLE : conversations.find((c) => c.id === conversationId)?.title ?? NEW_TITLE;
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;
  const showEmpty = messages.length === 0 && !busy;
  const placeholder = `Hỏi ${skill?.name ?? 'Claude'}…`;

  const composer = (
    <Composer
      value={input}
      onChange={setInput}
      onSend={() => { void send(); }}
      onStop={() => { void stop(); }}
      busy={busy}
      placeholder={placeholder}
      autoFocus
      inputRef={inputRef}
    />
  );

  return (
    <div className={`sc-root ${styles.root}`}>
      <div className={`${styles.backdrop} ${railOpen ? styles.backdropOpen : ''}`} onClick={() => setRailOpen(false)} />

      {/* Conversation rail */}
      <aside className={`${railCollapsed ? styles.railCollapsed : styles.rail} ${railOpen ? styles.railOpen : ''}`}>
        <div className={styles.railHead}>
          <div className={styles.railTop}>
            <Link href="/skills" className={styles.backLink}>← Tất cả skills</Link>
            <button type="button" className={styles.iconBtn} onClick={toggleRail} title="Ẩn danh sách" aria-label="Ẩn danh sách">
              {Icon.panel}
            </button>
          </div>
          {skill && (
            <div className={styles.skillBadge}>
              <span className={styles.skillBadgeIcon}>{skill.icon}</span>
              <div>
                <div className={styles.skillBadgeName}>{skill.name}</div>
                <div className={styles.skillBadgeCat}>{skill.category}</div>
              </div>
            </div>
          )}
          <button type="button" className={styles.newChatBtn} onClick={newChat}>
            {Icon.compose}
            Cuộc trò chuyện mới
          </button>
          {conversations.length > 6 && (
            <input
              className={styles.search}
              placeholder="Tìm cuộc trò chuyện…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
        </div>
        <div className={styles.convScroll}>
          {groups.length === 0 ? (
            <p className={styles.convEmpty}>{query ? 'Không tìm thấy.' : 'Chưa có cuộc trò chuyện nào.'}</p>
          ) : (
            groups.map((g) => (
              <div key={g.label}>
                <div className={styles.convGroupLabel}>{g.label}</div>
                {g.items.map((c) => (
                  <ConvItem
                    key={c.id}
                    conv={c}
                    active={c.id === conversationId}
                    skillId={skillId}
                    onRenamed={(id, t) => setConversations((prev) => prev.map((x) => (x.id === id ? { ...x, title: t } : x)))}
                    onDeleted={(id) => {
                      setConversations((prev) => prev.filter((x) => x.id !== id));
                      if (id === conversationId) router.push(`/skills/${skillId}/chat/new`);
                    }}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Main column */}
      <main className={styles.main}>
        <header className={styles.header}>
          <button
            type="button"
            className={`${styles.iconBtn} ${styles.railToggle} ${railCollapsed ? '' : styles.railToggleHidden}`}
            onClick={toggleRail}
            title="Danh sách cuộc trò chuyện"
            aria-label="Danh sách cuộc trò chuyện"
          >
            {Icon.panel}
          </button>
          <div className={styles.headerTitle}>
            {title}
            {skill && <span className={styles.headerSkill}>{skill.icon} {skill.name}</span>}
          </div>
          <button type="button" className={styles.iconBtn} onClick={newChat} title="Cuộc trò chuyện mới (⌘⇧O)" aria-label="Cuộc trò chuyện mới">
            {Icon.compose}
          </button>
        </header>

        <div ref={scrollerRef} className={styles.scroller} onScroll={onScroll}>
          {showEmpty ? (
            <div className={styles.empty}>
              <div className={styles.emptyInner}>
                <div className={styles.greeting}>
                  <div className={styles.greetingIcon}>{icon}</div>
                  <h1 className={styles.greetingTitle}>{skill?.name ?? 'Chat'}</h1>
                  {skill?.welcomeMessage && <p className={styles.greetingText}>{skill.welcomeMessage}</p>}
                </div>
                {composer}
                {notice && <div className={styles.notice}>{notice}</div>}
                {skill && skill.exampleQuestions.length > 0 && (
                  <div className={styles.suggestions}>
                    {skill.exampleQuestions.slice(0, 4).map((q) => (
                      <button key={q} type="button" className={styles.suggestion} onClick={() => { void send(q); }}>
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className={styles.thread}>
              {messages.map((m) =>
                m.role === 'user' ? (
                  <UserMessage key={m.id} msg={m} />
                ) : (
                  <AssistantMessage key={m.id} msg={m} icon={icon} isLast={m.id === lastAssistantId && !busy} onSetupChange={handleSetupChange} />
                ),
              )}

              {busy && <LiveMessage icon={icon} live={live} startedAt={liveStartedAt} stopping={status === 'stopping'} />}

              {status === 'error' && (
                <div className={styles.notice} role="alert">
                  <span>{notice ?? 'Claude gặp lỗi khi trả lời.'}</span>
                  <button type="button" className={styles.noticeBtn} onClick={() => { void retry(); }}>
                    {Icon.retry} Thử lại
                  </button>
                </div>
              )}
              {status === 'stopped' && messages[messages.length - 1]?.role === 'user' && (
                <div className={`${styles.notice} ${styles.noticeMuted}`}>
                  <span>Đã dừng trước khi Claude kịp trả lời.</span>
                  <button type="button" className={styles.noticeBtn} onClick={() => { void retry(); }}>
                    {Icon.retry} Trả lời lại
                  </button>
                </div>
              )}
              {status === 'idle' && notice && <div className={styles.notice}>{notice}</div>}
            </div>
          )}
        </div>

        {!showEmpty && (
          <div className={styles.dock}>
            {!atBottom && (
              <button type="button" className={styles.jumpBtn} onClick={() => scrollToBottom(true)} aria-label="Cuộn xuống cuối">
                {Icon.down}
              </button>
            )}
            <div className={styles.dockInner}>
              {composer}
              <div className={styles.disclaimer}>Phân tích tham khảo, không phải lời khuyên tài chính. Lệnh Accept là paper trade.</div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
