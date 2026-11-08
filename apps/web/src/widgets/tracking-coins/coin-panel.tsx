'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createApiClient } from '@web/shared/api/client';
import type { ChatMessage, Conversation, LiveReply, SpotTradeCard, TrackingSetup } from '@web/shared/api/types';
import { AssistantMessage, Composer, Icon, LiveMessage, UserMessage, chatStyles as c } from '@web/shared/ui/chat/chat-parts';

import { SetupCard, SetupFormModal, fmtDateTime } from './setup-card';
import { SpotTradeCardView } from './spot-trade-card';
import styles from './tracking.module.css';

const api = createApiClient();

export const TRACKING_SKILL_ID = 'tracking-swing';
const POLL_MS = 600;
const WATCH_TIMEOUT_MS = 8 * 60 * 1000;
const RESUME_WINDOW_MS = 10 * 60 * 1000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Status = 'idle' | 'waiting' | 'stopping' | 'error' | 'stopped';

/**
 * Right-side panel for one coin (or the whole watchlist when `symbol` is null):
 * Claude chat for spot dip-buying (target ~30% per leg).
 */
export function CoinPanel({
  symbol,
  symbols,
  onClose,
  onChanged,
}: {
  symbol: string | null;
  symbols: string[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<TrackingSetup | null | 'new'>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !editing && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, editing]);

  // Old swing setup cards (if any) can still be edited from a past reply.
  const changed = useCallback(() => onChanged(), [onChanged]);

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <aside className={styles.drawer} aria-label={symbol ? `Spot ${symbol}` : 'Quét danh sách'}>
        <div className={styles.drawerHead}>
          <div className={styles.drawerTitle}>
            {symbol ?? 'Quét cả danh sách'}
            <span className={styles.drawerSub}>{symbol ? 'Mua lướt spot · mục tiêu ~30%/nhịp' : 'Claude tìm coin đáng mua spot nhất'}</span>
          </div>
          {symbol && (
            <a className={styles.btn} href={`https://www.tradingview.com/chart/?symbol=BINANCE:${symbol}USDT`} target="_blank" rel="noopener noreferrer">
              TradingView ↗
            </a>
          )}
          <button type="button" className={styles.close} onClick={onClose} aria-label="Đóng">✕</button>
        </div>

        <div className={styles.drawerChat}>
          <AnalysisChat symbol={symbol} onSetupChange={changed} onEdit={(s) => setEditing(s)} />
        </div>
      </aside>

      {editing && (
        <SetupFormModal
          symbols={symbol ? [symbol] : symbols}
          defaultSymbol={symbol}
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={changed}
        />
      )}
    </>
  );
}

// ── Analysis chat (same look as the /skills chat page) ───────────────────────

const ICON = '🧭';

function suggestionsFor(symbol: string | null): string[] {
  return symbol
    ? [
        `${symbol} có đáng mua spot lúc này không? Vùng mua và mục tiêu +30% ở đâu?`,
        `Mình đang giữ ${symbol} thế nào trong portfolio? Nên gom thêm hay chốt lời?`,
        `Lên kế hoạch mua ${symbol} chia 3 phần: giá mua từng phần, giá bán chốt lời.`,
        `Vừa mua ${symbol}: ghi lệnh vào portfolio giúp mình (số lượng, giá).`,
      ]
    : [
        'Quét danh sách, chọn tối đa 3 coin đáng mua spot nhất (còn dư địa +30%) và cho vùng mua.',
        'Coin nào trong danh sách đang giảm sâu về hỗ trợ mạnh, đáng gom?',
        'Coin nào vừa bật khỏi đáy và còn dư địa tăng ~30%?',
        'Coin nào đã tăng quá nóng, không nên mua đuổi lúc này?',
      ];
}

function AnalysisChat({
  symbol,
  onSetupChange,
  onEdit,
}: {
  symbol: string | null;
  onSetupChange: (s: TrackingSetup) => void;
  onEdit: (s: TrackingSetup) => void;
}) {
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [convId, setConvId] = useState<string | null>(null);
  // "Lịch sử": every saved conversation of this page (all coins + list scans), open or delete.
  const [view, setView] = useState<'chat' | 'history'>('chat');
  const [history, setHistory] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [live, setLive] = useState<LiveReply | null>(null);
  const [startedAt, setStartedAt] = useState(Date.now());
  const [notice, setNotice] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const watchGen = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const busy = status === 'waiting' || status === 'stopping';

  useEffect(() => () => { watchGen.current += 1; }, []);

  // Follow new content only while the reader is at the bottom.
  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
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

  const open = useCallback(
    async (id: string) => {
      watchGen.current += 1;
      setConvId(id);
      setStatus('idle');
      setLive(null);
      setNotice(null);
      atBottomRef.current = true;
      try {
        const msgs = await api.getMessages(id);
        setMessages(msgs);
        const last = msgs[msgs.length - 1];
        if (last?.role === 'user' && Date.now() - new Date(last.createdAt).getTime() < RESUME_WINDOW_MS) {
          setStartedAt(new Date(last.createdAt).getTime());
          void watch(id, last.createdAt);
        }
      } catch {
        setMessages([]);
      }
    },
    [watch],
  );

  // Past analyses of this coin (or the watchlist scans); the latest opens by default.
  useEffect(() => {
    let cancelled = false;
    api
      .listConversations(TRACKING_SKILL_ID)
      .then((all) => {
        if (cancelled) return;
        const mine = all
          .filter((c) => (symbol ? c.metadata?.symbol === symbol : !c.metadata?.symbol))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        setConvs(mine);
        if (mine[0]) void open(mine[0].id);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [symbol, open]);

  const loadHistory = useCallback(async () => {
    const all = await api.listConversations(TRACKING_SKILL_ID).catch(() => [] as Conversation[]);
    setHistory([...all].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }, []);

  async function removeConversation(id: string) {
    if (!window.confirm('Xoá cuộc trò chuyện này? Không khôi phục được.')) return;
    await api.deleteConversation(id).catch(() => {});
    setHistory((prev) => prev.filter((x) => x.id !== id));
    setConvs((prev) => prev.filter((x) => x.id !== id));
    if (id === convId) newChat();
  }

  function newChat() {
    setView('chat');
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
    setLive(null);
    setStatus('waiting');
    try {
      let id = convId;
      if (!id) {
        const date = new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
        const conv = await api.createConversation(`${symbol ?? 'Quét danh sách'} · ${date}`, TRACKING_SKILL_ID, undefined, undefined, symbol ?? undefined);
        id = conv.id;
        setConvs((prev) => [conv, ...prev]);
        setConvId(id);
        api.generateTitle(id).then(({ title }) => setConvs((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)))).catch(() => {});
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

  function spotChanged(t: SpotTradeCard) {
    setMessages((prev) => prev.map((m) => (m.spotTrades?.some((x) => x.id === t.id) ? { ...m, spotTrades: m.spotTrades.map((x) => (x.id === t.id ? t : x)) } : m)));
  }

  function setupChanged(s: TrackingSetup) {
    setMessages((prev) => prev.map((m) => (m.trackingSetups?.some((x) => x.id === s.id) ? { ...m, trackingSetups: m.trackingSetups.map((x) => (x.id === s.id ? s : x)) } : m)));
    onSetupChange(s);
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
      placeholder={symbol ? `Hỏi về ${symbol}…` : 'Hỏi về danh sách theo dõi…'}
      autoFocus
      inputRef={inputRef}
    />
  );

  return (
    <div className={c.embed}>
      <div className={c.embedBar}>
        {convs.length > 0 && convId ? (
          <select className={c.embedSelect} value={convId} disabled={busy} onChange={(e) => void open(e.target.value)} aria-label="Các lần phân tích">
            {convs.map((x) => (
              <option key={x.id} value={x.id}>{x.title} — {fmtDateTime(x.updatedAt)}</option>
            ))}
          </select>
        ) : (
          <span className={c.embedTitle}>{convs.length > 0 ? 'Phân tích mới' : symbol ? `Phân tích ${symbol}` : 'Quét danh sách'}</span>
        )}
        <button
          type="button"
          className={`${c.iconBtn} ${view === 'history' ? styles.historyBtnOn : ''}`}
          onClick={() => {
            const next = view === 'history' ? 'chat' : 'history';
            setView(next);
            if (next === 'history') void loadHistory();
          }}
          title="Lịch sử chat của trang này (xem lại / xoá)"
          aria-label="Lịch sử chat"
        >
          🕘
        </button>
        <button type="button" className={c.iconBtn} onClick={newChat} disabled={busy} title="Phân tích mới" aria-label="Phân tích mới">
          {Icon.compose}
        </button>
      </div>

      {view === 'history' && (
        <div className={`${c.scroller} ${styles.history}`}>
          {history.length === 0 ? (
            <p className={styles.historyEmpty}>Chưa có cuộc trò chuyện nào.</p>
          ) : (
            <ul className={styles.historyList}>
              {history.map((cv) => (
                <li key={cv.id} className={`${styles.historyItem} ${cv.id === convId ? styles.historyItemOn : ''}`}>
                  <button
                    type="button"
                    className={styles.historyOpen}
                    disabled={busy}
                    onClick={() => {
                      setView('chat');
                      if (!convs.some((x) => x.id === cv.id)) setConvs((prev) => [cv, ...prev]);
                      void open(cv.id);
                    }}
                  >
                    <span className={styles.historyTitle}>{cv.title}</span>
                    <span className={styles.historyMeta}>
                      {(cv.metadata?.symbol as string | undefined) ?? 'Quét danh sách'} · {fmtDateTime(cv.updatedAt)}
                    </span>
                  </button>
                  <button type="button" className={styles.historyDel} onClick={() => void removeConversation(cv.id)} aria-label="Xoá" title="Xoá">
                    {Icon.trash}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div ref={scrollerRef} className={c.scroller} onScroll={onScroll} hidden={view === 'history'}>
        {!loaded ? null : showEmpty ? (
          <div className={c.empty}>
            <div className={c.emptyInner}>
              <div className={c.greeting}>
                <div className={c.greetingIcon}>{ICON}</div>
                <h1 className={c.greetingTitle}>{symbol ?? 'Quét danh sách'}</h1>
                <p className={c.greetingText}>
                  {symbol
                    ? `Claude đọc cấu trúc 1W / 1D và vị thế ${symbol} trong portfolio của bạn, tìm vùng mua spot, chia 3 phần mua, mục tiêu ~+30% mỗi nhịp. Báo “đã mua / đã bán …” để Claude tạo thẻ ghi lệnh vào portfolio.`
                    : 'Claude đọc toàn bộ danh sách theo dõi và chọn tối đa 3 coin đáng mua spot nhất (còn dư địa ~+30%).'}
                </p>
              </div>
              {composer}
              {notice && <div className={c.notice}>{notice}</div>}
              <div className={c.suggestions}>
                {suggestionsFor(symbol).map((q) => (
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
                <AssistantMessage key={m.id} msg={m} icon={ICON} isLast={m.id === lastAssistantId && !busy}>
                  {m.spotTrades && m.spotTrades.length > 0 && (
                    <div className={styles.cards}>
                      {m.spotTrades.map((t) => (
                        <SpotTradeCardView key={t.id} trade={t} onChange={spotChanged} />
                      ))}
                    </div>
                  )}
                  {m.trackingSetups && m.trackingSetups.length > 0 && (
                    <div className={styles.cards}>
                      {m.trackingSetups.map((s) => (
                        <SetupCard key={s.id} setup={s} onChange={setupChanged} onEdit={onEdit} showSymbol={!symbol} />
                      ))}
                    </div>
                  )}
                </AssistantMessage>
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

      {loaded && !showEmpty && view === 'chat' && (
        <div className={c.dock}>
          {!atBottom && (
            <button type="button" className={c.jumpBtn} onClick={() => scrollToBottom(true)} aria-label="Cuộn xuống cuối">
              {Icon.down}
            </button>
          )}
          <div className={c.dockInner}>
            {composer}
            <div className={c.disclaimer}>Phân tích tham khảo, không phải lời khuyên tài chính. Lệnh là paper trade.</div>
          </div>
        </div>
      )}
    </div>
  );
}

