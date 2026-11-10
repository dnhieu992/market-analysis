'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { ChartSample, ChatMessage, LiveReply } from '@web/shared/api/types';
import { AssistantMessage, Composer, Icon, LiveMessage, UserMessage, chatStyles as c } from '@web/shared/ui/chat/chat-parts';

import styles from '../bitget/bitget-ai-chat.module.css';
import s from './chart-lab.module.css';

const api = createApiClient();
const ICON = '🧪';
const POLL_MS = 600;
const WATCH_TIMEOUT_MS = 8 * 60 * 1000;
const RESUME_WINDOW_MS = 10 * 60 * 1000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Status = 'idle' | 'waiting' | 'stopping' | 'error' | 'stopped';

/**
 * Claude panel of one chart. Nothing runs until the user clicks Analyze; afterwards follow-up questions go to
 * the same thread (the server re-attaches the chart + similar charts every turn).
 */
export function ChartLabChat({ sample, onAnalyzed, dirty }: { sample: ChartSample; onAnalyzed: (s: ChartSample) => void; dirty: boolean }) {
  const [convId, setConvId] = useState<string | null>(sample.conversationId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [live, setLive] = useState<LiveReply | null>(null);
  const [startedAt, setStartedAt] = useState(Date.now());
  const [notice, setNotice] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [loaded, setLoaded] = useState(!sample.conversationId);
  const watchGen = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const busy = status === 'waiting' || status === 'stopping';

  useEffect(() => () => {
    watchGen.current += 1;
  }, []);

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
          // The Analyze answer is stored on the chart — refresh it for the list badge.
          api.fetchChartSample(sample.id).then(onAnalyzed).catch(() => {});
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!sample.conversationId) return;
    let cancelled = false;
    api
      .getMessages(sample.conversationId)
      .then((msgs) => {
        if (cancelled) return;
        setMessages(msgs);
        const last = msgs[msgs.length - 1];
        if (last?.role === 'user' && Date.now() - new Date(last.createdAt).getTime() < RESUME_WINDOW_MS) {
          setStartedAt(new Date(last.createdAt).getTime());
          void watch(sample.conversationId!, last.createdAt);
        }
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
    // Only on open — the thread is ours afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        id = (await api.chartSampleConversation(sample.id)).conversationId;
        setConvId(id);
      }
      const saved = await api.sendMessage(id, content);
      setMessages((prev) => prev.map((m) => (m.id === temp.id ? saved : m)));
      await watch(id, saved.createdAt);
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== temp.id));
      setInput(content);
      setStatus('idle');
      setNotice(e instanceof Error ? e.message : 'Gửi thất bại. Vui lòng thử lại.');
    }
  }

  /** The only way this page calls Claude: evaluate the user's analysis + analyze the chart. */
  async function analyze() {
    if (busy) return;
    setNotice(null);
    atBottomRef.current = true;
    setStartedAt(Date.now());
    setStatus('waiting');
    try {
      const { conversationId } = await api.analyzeChartSample(sample.id);
      setConvId(conversationId);
      const msgs = await api.getMessages(conversationId);
      setMessages(msgs);
      const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
      await watch(conversationId, lastUser?.createdAt ?? new Date().toISOString());
    } catch (e) {
      setStatus('idle');
      setNotice(e instanceof Error ? e.message : 'Không gọi được Claude.');
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

  const empty = loaded && messages.length === 0 && !busy;
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;

  return (
    <div className={`${c.embed} ${styles.thread}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div className={styles.head}>
        <span className={styles.headIcon} aria-hidden>
          {ICON}
        </span>
        <div className={styles.headTitle}>
          Claude
          <span className={styles.headSub}>{sample.analyzedAt ? `Analyze lần cuối ${new Date(sample.analyzedAt).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : 'Chỉ chạy khi bạn bấm Analyze'}</span>
        </div>
        {messages.length > 0 && (
          <button type="button" className={styles.headBtn} onClick={() => void analyze()} disabled={busy || dirty} title={dirty ? 'Lưu phân tích trước' : 'Analyze lại với dữ liệu mới nhất'}>
            🔍 <span>Analyze lại</span>
          </button>
        )}
      </div>

      <div ref={scrollerRef} className={c.scroller} onScroll={onScroll} style={{ flex: 1, minHeight: 0 }}>
        {!loaded ? null : empty ? (
          <div className={s.chatStart}>
            <span>
              Bấm Analyze, Claude sẽ xem ảnh chart, phân tích của bạn, kết quả thật trên Binance và các chart cũ giống nhất trong kho. Sau đó Claude đánh giá nhận định của bạn
              đúng hay sai và vì sao, đưa ra phân tích riêng, rồi tóm tắt bài học. Mất khoảng 30–60 giây.
            </span>
            <button type="button" className={s.primaryBtn} onClick={() => void analyze()} disabled={dirty}>
              🔍 Analyze
            </button>
            {dirty && <span className={s.hintBad}>Lưu phân tích của bạn trước khi Analyze.</span>}
            {notice && <div className={c.notice}>{notice}</div>}
          </div>
        ) : (
          <div className={c.thread}>
            {messages.map((m) =>
              m.role === 'user' ? <UserMessage key={m.id} msg={m} /> : <AssistantMessage key={m.id} msg={m} icon={ICON} isLast={m.id === lastAssistantId && !busy} />,
            )}
            {busy && <LiveMessage icon={ICON} live={live} startedAt={startedAt} stopping={status === 'stopping'} />}
            {status === 'error' && (
              <div className={c.notice} role="alert">
                <span>{notice ?? 'Claude gặp lỗi khi trả lời.'}</span>
                <button type="button" className={c.noticeBtn} onClick={() => void retry()}>
                  {Icon.retry} Thử lại
                </button>
              </div>
            )}
            {status === 'stopped' && messages[messages.length - 1]?.role === 'user' && (
              <div className={`${c.notice} ${c.noticeMuted}`}>
                <span>Đã dừng trước khi Claude kịp trả lời.</span>
                <button type="button" className={c.noticeBtn} onClick={() => void retry()}>
                  {Icon.retry} Trả lời lại
                </button>
              </div>
            )}
            {status === 'idle' && notice && <div className={c.notice}>{notice}</div>}
          </div>
        )}
      </div>

      {messages.length > 0 && (
      <div className={c.dock}>
        <div className={c.dockInner}>
          <Composer
            value={input}
            onChange={setInput}
            onSend={() => void send()}
            onStop={() => void stop()}
            busy={busy}
            placeholder="Hỏi thêm Claude về chart này…"
            inputRef={inputRef}
          />
          <div className={c.disclaimer}>Phân tích tham khảo, không phải lời khuyên tài chính.</div>
        </div>
      </div>
      )}
    </div>
  );
}
