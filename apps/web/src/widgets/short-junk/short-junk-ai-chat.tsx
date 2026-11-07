'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { ChatMessage, Conversation, LiveReply } from '@web/shared/api/types';
import { AssistantMessage, Composer, Icon, LiveMessage, UserMessage, chatStyles as c } from '@web/shared/ui/chat/chat-parts';

// Same floating button + slide-in panel as the /trading-list and /bitget AI chats.
import styles from '../bitget/bitget-ai-chat.module.css';

const api = createApiClient();

const SKILL_ID = 'short-junk';
const ICON = '🗑️';
const TITLE = 'Short Coin Rác AI';
const POLL_MS = 600;
const WATCH_TIMEOUT_MS = 8 * 60 * 1000;
const RESUME_WINDOW_MS = 10 * 60 * 1000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Status = 'idle' | 'waiting' | 'stopping' | 'error' | 'stopped';

const SUGGESTIONS = [
  'Scan danh sách coin rác hôm nay, có con nào short được không?',
  'Con nào trong danh sách vừa pump mạnh 3 ngày qua để short xả?',
  'Coin nào trong danh sách đang tăng mạnh 24h, sắp thành setup?',
  'Lên kế hoạch short chia tầng cho coin đứng đầu danh sách',
];

/** Floating "AI" button on /short-junk → slide-in chat with the short-junk skill (one running thread). */
export function ShortJunkAiChat({ coinCount }: { coinCount: number }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      {!open && (
        <button type="button" className={styles.fab} onClick={() => setOpen(true)} aria-label={`Mở ${TITLE}`} title={TITLE}>
          <span aria-hidden>{ICON}</span>
          <span className={styles.fabLabel}>AI</span>
        </button>
      )}
      {open && (
        <>
          <div className={styles.backdrop} onClick={() => setOpen(false)} />
          <aside className={styles.panel} role="dialog" aria-label={TITLE}>
            <AiThread coinCount={coinCount} onClose={() => setOpen(false)} />
          </aside>
        </>
      )}
    </>
  );
}

function AiThread({ coinCount, onClose }: { coinCount: number; onClose: () => void }) {
  const [convId, setConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [live, setLive] = useState<LiveReply | null>(null);
  const [startedAt, setStartedAt] = useState(Date.now());
  const [notice, setNotice] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [loaded, setLoaded] = useState(false);
  const watchGen = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const busy = status === 'waiting' || status === 'stopping';

  useEffect(() => () => { watchGen.current += 1; }, []);

  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (el) atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (el && atBottomRef.current) el.scrollTo({ top: el.scrollHeight });
  }, [messages, live?.text, live?.phase, status]);

  const watch = useCallback(async (id: string, sinceIso: string) => {
    const gen = ++watchGen.current;
    const started = Date.now();
    setStatus('waiting');
    setLive(null);
    setNotice(null);
    let idle = 0;
    while (watchGen.current === gen) {
      let l: LiveReply | null = null;
      try {
        l = await api.getLiveReply(id);
      } catch {
        /* transient */
      }
      if (watchGen.current !== gen) return;
      if (l?.active) {
        idle = 0;
        setLive(l);
        await sleep(POLL_MS);
        continue;
      }
      try {
        const msgs = await api.getMessages(id);
        if (watchGen.current !== gen) return;
        setMessages(msgs);
        if (msgs.some((m) => m.role === 'assistant' && m.createdAt >= sinceIso)) {
          setLive(null);
          setStatus('idle');
          setTimeout(() => inputRef.current?.focus(), 30);
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
  }, []);

  // One running thread: the newest short-junk conversation opens; "Bắt đầu lại" starts a fresh one.
  useEffect(() => {
    let cancelled = false;
    api
      .listConversations(SKILL_ID)
      .then(async (all: Conversation[]) => {
        const latest = [...all].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
        if (cancelled || !latest) return;
        setConvId(latest.id);
        const msgs = await api.getMessages(latest.id);
        if (cancelled) return;
        setMessages(msgs);
        const last = msgs[msgs.length - 1];
        if (last?.role === 'user' && Date.now() - new Date(last.createdAt).getTime() < RESUME_WINDOW_MS) {
          setStartedAt(new Date(last.createdAt).getTime());
          void watch(latest.id, last.createdAt);
        }
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [watch]);

  function restart() {
    watchGen.current += 1;
    setConvId(null);
    setMessages([]);
    setStatus('idle');
    setLive(null);
    setNotice(null);
    setTimeout(() => inputRef.current?.focus(), 30);
  }

  async function send(textArg?: string) {
    const content = (textArg ?? input).trim();
    if (!content || busy) return;
    setInput('');
    setNotice(null);
    atBottomRef.current = true;
    const temp: ChatMessage = { id: `temp-${Date.now()}`, conversationId: convId ?? 'new', role: 'user', content, createdAt: new Date().toISOString() };
    setMessages((prev) => [...prev, temp]);
    setStartedAt(Date.now());
    setStatus('waiting');
    try {
      let id = convId;
      if (!id) {
        const date = new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
        const conv = await api.createConversation(`Short Coin Rác · ${date}`, SKILL_ID);
        id = conv.id;
        setConvId(id);
      }
      const saved = await api.sendMessage(id, content, `Trang /short-junk (danh sách coin rác: ${coinCount} coin)`);
      setMessages((prev) => prev.map((m) => (m.id === temp.id ? saved : m)));
      await watch(id, saved.createdAt);
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== temp.id));
      setInput(content);
      setStatus('idle');
      setNotice(e instanceof Error ? e.message : 'Gửi thất bại. Vui lòng thử lại.');
    }
  }

  async function stop() {
    if (!convId || status !== 'waiting') return;
    setStatus('stopping');
    try {
      await api.stopReply(convId);
    } catch {
      setStatus('waiting');
    }
  }

  async function retry() {
    if (!convId) return;
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    setNotice(null);
    setStartedAt(Date.now());
    try {
      await api.retryReply(convId);
      await watch(convId, lastUser.createdAt);
    } catch (e) {
      setStatus('error');
      setNotice(e instanceof Error ? e.message : 'Không thử lại được.');
    }
  }

  const showEmpty = loaded && messages.length === 0 && !busy;
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;
  const composer = (
    <Composer
      value={input}
      onChange={setInput}
      onSend={() => { void send(); }}
      onStop={() => { void stop(); }}
      busy={busy}
      placeholder="Hỏi về các coin rác trong danh sách…"
      autoFocus
      inputRef={inputRef}
    />
  );

  return (
    <div className={`${c.embed} ${styles.thread}`}>
      <div className={styles.head}>
        <span className={styles.headIcon} aria-hidden>{ICON}</span>
        <div className={styles.headTitle}>
          {TITLE}
          <span className={styles.headSub}>Chỉ scan {coinCount} coin trong danh sách</span>
        </div>
        <button type="button" className={styles.headBtn} onClick={restart} disabled={busy || (!convId && messages.length === 0)} title="Bắt đầu cuộc trò chuyện mới">
          {Icon.compose} <span>Bắt đầu lại</span>
        </button>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Đóng">✕</button>
      </div>

      <div ref={scrollerRef} className={c.scroller} onScroll={onScroll}>
        {!loaded ? null : showEmpty ? (
          <div className={c.empty}>
            <div className={c.emptyInner}>
              <div className={c.greeting}>
                <div className={c.greetingIcon}>{ICON}</div>
                <h1 className={c.greetingTitle}>{TITLE}</h1>
                <p className={c.greetingText}>
                  {coinCount === 0
                    ? 'Danh sách coin rác đang trống — thêm coin ở trang này trước, AI chỉ scan các coin trong danh sách.'
                    : `Scan ${coinCount} coin trong danh sách theo 2 quy luật đã backtest: (A) xả sau pump ≥ +50%/3 ngày, (B) hồi EMA20 trong downtrend khi BTC yếu. Mỗi lệnh có kế hoạch 3 tầng + stop cứng; coin không đạt tiêu chí nghiên cứu bị gắn cờ đỏ.`}
                </p>
              </div>
              {composer}
              {notice && <div className={c.notice}>{notice}</div>}
              <div className={c.suggestions}>
                {SUGGESTIONS.map((q) => (
                  <button key={q} type="button" className={c.suggestion} onClick={() => { void send(q); }}>
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className={c.thread}>
            {messages.map((m) =>
              m.role === 'user' ? (
                <UserMessage key={m.id} msg={m} />
              ) : (
                <AssistantMessage key={m.id} msg={m} icon={ICON} isLast={m.id === lastAssistantId && !busy} />
              ),
            )}
            {busy && <LiveMessage icon={ICON} live={live} startedAt={startedAt} stopping={status === 'stopping'} />}
            {status === 'error' && (
              <div className={c.notice} role="alert">
                <span>{notice ?? 'Claude gặp lỗi khi trả lời.'}</span>
                <button type="button" className={c.noticeBtn} onClick={() => { void retry(); }}>
                  {Icon.retry} Thử lại
                </button>
              </div>
            )}
            {status === 'stopped' && messages[messages.length - 1]?.role === 'user' && (
              <div className={`${c.notice} ${c.noticeMuted}`}>
                <span>Đã dừng trước khi Claude kịp trả lời.</span>
                <button type="button" className={c.noticeBtn} onClick={() => { void retry(); }}>
                  {Icon.retry} Trả lời lại
                </button>
              </div>
            )}
            {status === 'idle' && notice && <div className={c.notice}>{notice}</div>}
          </div>
        )}
      </div>

      {loaded && !showEmpty && (
        <div className={c.dock}>
          <div className={c.dockInner}>
            {composer}
            <div className={c.disclaimer}>Phân tích tham khảo, không phải lời khuyên tài chính · luôn đặt stop cứng.</div>
          </div>
        </div>
      )}
    </div>
  );
}
