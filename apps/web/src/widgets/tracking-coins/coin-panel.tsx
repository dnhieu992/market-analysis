'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createApiClient } from '@web/shared/api/client';
import type { ChatMessage, Conversation, LiveReply, TrackingEvent, TrackingSetup } from '@web/shared/api/types';
import { renderChatMarkdown } from '@web/shared/lib/chat-markdown';
import { ImageUpload, type ImageUploadValue } from '@web/shared/ui/image-upload/image-upload';

import { SetupCard, SetupFormModal, fmtDateTime, fmtPx } from './setup-card';
import styles from './tracking.module.css';

const api = createApiClient();

export const TRACKING_SKILL_ID = 'tracking-swing';
const POLL_MS = 700;
const WATCH_TIMEOUT_MS = 8 * 60 * 1000;
const RESUME_WINDOW_MS = 10 * 60 * 1000;
const REFRESH_MS = 30_000;

const TOOL_LABEL: Record<string, string> = {
  analyze_market_structure: 'Đang phân tích cấu trúc thị trường',
  get_klines: 'Đang lấy dữ liệu nến',
  get_ticker_price: 'Đang lấy giá hiện tại',
  get_tracking_coins: 'Đang đọc danh sách coin theo dõi',
  propose_swing_setup: 'Đang tạo setup',
};

const EVENT_LABEL: Record<string, string> = {
  CREATED: 'Tạo setup',
  ANALYSIS: 'Phân tích',
  WATCHING: 'Theo dõi',
  PLACED: 'Đặt lệnh',
  FILLED: 'Khớp lệnh',
  TP_HIT: 'Chạm TP',
  STOP_MOVED: 'Dời SL',
  MANUAL_CLOSE: 'Đóng tay',
  CLOSED: 'Đóng lệnh',
  CANCELLED: 'Huỷ',
  DISCARDED: 'Bỏ',
  EDITED: 'Sửa',
  REVIEW: 'Tự đánh giá',
  POSTMORTEM: 'Rút kinh nghiệm',
  NOTE: 'Ghi chú',
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Tab = 'chat' | 'setups' | 'journal';
type Status = 'idle' | 'waiting' | 'stopping' | 'error' | 'stopped';

function Markdown({ text }: { text: string }) {
  const html = useMemo(() => renderChatMarkdown(text), [text]);
  // eslint-disable-next-line react/no-danger
  return <div className={styles.prose} dangerouslySetInnerHTML={{ __html: html }} />;
}

function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div className={styles.lightbox} onClick={onClose}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" />
    </div>
  );
}

/**
 * Right-side panel for one coin (or the whole watchlist when `symbol` is null):
 * Claude analysis chat, the coin's setups, and its journal.
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
  const [tab, setTab] = useState<Tab>('chat');
  const [setups, setSetups] = useState<TrackingSetup[]>([]);
  const [events, setEvents] = useState<TrackingEvent[]>([]);
  const [editing, setEditing] = useState<TrackingSetup | null | 'new'>(null);

  const loadCoin = useCallback(async () => {
    if (!symbol) return;
    try {
      const res = await api.fetchTrackingCoin(symbol);
      setSetups(res.setups);
      setEvents(res.events);
    } catch {
      /* keep what we have */
    }
  }, [symbol]);

  useEffect(() => {
    void loadCoin();
    const id = setInterval(() => void loadCoin(), REFRESH_MS);
    return () => clearInterval(id);
  }, [loadCoin]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !editing && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, editing]);

  const changed = useCallback(
    (s: TrackingSetup) => {
      setSetups((prev) => (prev.some((x) => x.id === s.id) ? prev.map((x) => (x.id === s.id ? s : x)) : [s, ...prev]));
      void loadCoin();
      onChanged();
    },
    [loadCoin, onChanged],
  );

  const active = setups.filter((s) => ['PROPOSED', 'WATCHING', 'PENDING', 'OPEN'].includes(s.status));

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <aside className={styles.drawer} aria-label={symbol ? `Swing ${symbol}` : 'Quét danh sách'}>
        <div className={styles.drawerHead}>
          <div className={styles.drawerTitle}>
            {symbol ?? 'Quét cả danh sách'}
            <span className={styles.drawerSub}>{symbol ? 'Swing 4H – 1D · paper' : 'Claude chọn coin có setup tốt nhất'}</span>
          </div>
          {symbol && (
            <a className={styles.btn} href={`https://www.tradingview.com/chart/?symbol=BINANCE:${symbol}USDT`} target="_blank" rel="noopener noreferrer">
              TradingView ↗
            </a>
          )}
          <button type="button" className={styles.close} onClick={onClose} aria-label="Đóng">✕</button>
        </div>

        <div className={`${styles.tabs} ${styles.drawerTabs}`}>
          <button type="button" className={`${styles.tab} ${tab === 'chat' ? styles.tabActive : ''}`} onClick={() => setTab('chat')}>Phân tích</button>
          {symbol && (
            <>
              <button type="button" className={`${styles.tab} ${tab === 'setups' ? styles.tabActive : ''}`} onClick={() => setTab('setups')}>
                Lệnh{active.length > 0 && <span className={styles.count}>{active.length}</span>}
              </button>
              <button type="button" className={`${styles.tab} ${tab === 'journal' ? styles.tabActive : ''}`} onClick={() => setTab('journal')}>
                Nhật ký
              </button>
            </>
          )}
        </div>

        <div className={styles.drawerBody}>
          {tab === 'chat' && <AnalysisChat symbol={symbol} onSetupChange={changed} onEdit={(s) => setEditing(s)} />}
          {tab === 'setups' && symbol && (
            <>
              <div className={styles.row} style={{ marginTop: 10 }}>
                <span className={styles.hint}>{setups.length} setup</span>
                <span className={styles.spacer} />
                <button type="button" className={styles.btn} onClick={() => setEditing('new')}>+ Setup tay</button>
              </div>
              <div className={styles.cards}>
                {setups.length === 0 && <p className={styles.hint}>Chưa có setup nào. Bấm “Phân tích” để Claude đề xuất, hoặc tự nhập.</p>}
                {setups.map((s) => (
                  <SetupCard key={s.id} setup={s} onChange={changed} onEdit={(x) => setEditing(x)} />
                ))}
              </div>
            </>
          )}
          {tab === 'journal' && symbol && <Journal symbol={symbol} setups={setups} events={events} onAdded={() => void loadCoin()} />}
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

// ── Analysis chat ────────────────────────────────────────────────────────────

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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [live, setLive] = useState<LiveReply | null>(null);
  const [startedAt, setStartedAt] = useState(Date.now());
  const [notice, setNotice] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [loaded, setLoaded] = useState(false);
  const watchGen = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const busy = status === 'waiting' || status === 'stopping';

  useEffect(() => () => { watchGen.current += 1; }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, live?.text, status]);

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
      if ((l?.phase === 'idle' && ++idle >= 3) || Date.now() - started > WATCH_TIMEOUT_MS) {
        setLive(null);
        setStatus('error');
        setNotice('Không còn phiên trả lời (server có thể vừa khởi động lại) hoặc chờ quá lâu.');
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
      setNotice(null);
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

  async function send(text: string, fresh = false) {
    const content = text.trim();
    if (!content || busy) return;
    setInput('');
    setNotice(null);
    setStartedAt(Date.now());
    setStatus('waiting');
    try {
      let id = fresh ? null : convId;
      if (!id) {
        const date = new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
        const conv = await api.createConversation(`${symbol ?? 'Quét danh sách'} · ${date}`, TRACKING_SKILL_ID, undefined, undefined, symbol ?? undefined);
        id = conv.id;
        setConvs((prev) => [conv, ...prev]);
        setConvId(id);
        setMessages([]);
      }
      const temp: ChatMessage = { id: `temp-${Date.now()}`, conversationId: id, role: 'user', content, createdAt: new Date().toISOString() };
      setMessages((prev) => [...prev, temp]);
      const saved = await api.sendMessage(id, content);
      setMessages((prev) => prev.map((m) => (m.id === temp.id ? saved : m)));
      await watch(id, saved.createdAt);
    } catch (e) {
      setStatus('idle');
      setInput(content);
      setNotice(e instanceof Error ? e.message : 'Gửi thất bại.');
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
    setStartedAt(Date.now());
    try {
      await api.retryReply(convId);
      await watch(convId, lastUser.createdAt);
    } catch (e) {
      setStatus('error');
      setNotice(e instanceof Error ? e.message : 'Không thử lại được.');
    }
  }

  function setupChanged(s: TrackingSetup) {
    setMessages((prev) => prev.map((m) => (m.trackingSetups?.some((x) => x.id === s.id) ? { ...m, trackingSetups: m.trackingSetups.map((x) => (x.id === s.id ? s : x)) } : m)));
    onSetupChange(s);
  }

  const startPrompt = symbol
    ? `Phân tích swing ${symbol} (1W / 1D / 4H) và đề xuất setup nếu đủ điều kiện.`
    : 'Quét danh sách theo dõi của tôi, chọn tối đa 3 coin có cấu trúc swing đẹp nhất lúc này, phân tích và đề xuất setup cho từng coin.';

  return (
    <div className={styles.chat}>
      <div className={styles.row}>
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy} onClick={() => void send(startPrompt, true)}>
          {symbol ? (convs.length ? 'Phân tích lại' : 'Phân tích') : 'Quét ngay'}
        </button>
        {convs.length > 1 && (
          <select className={styles.select} value={convId ?? ''} disabled={busy} onChange={(e) => void open(e.target.value)}>
            {convs.map((c) => (
              <option key={c.id} value={c.id}>{c.title} — {fmtDateTime(c.updatedAt)}</option>
            ))}
          </select>
        )}
      </div>

      {loaded && messages.length === 0 && !busy && (
        <p className={styles.hint}>
          {symbol
            ? `Claude đọc cấu trúc W/D/4H của ${symbol}, setup đang có và bài học đã duyệt, rồi đề xuất setup (nếu có) để bạn Theo dõi / Đặt lệnh.`
            : 'Claude đọc toàn bộ danh sách theo dõi và chọn vài coin đáng chú ý nhất.'}
        </p>
      )}

      {messages.map((m) =>
        m.role === 'user' ? (
          <div key={m.id} className={styles.msgUser}>{m.content}</div>
        ) : (
          <div key={m.id} className={styles.msgAssistant}>
            <Markdown text={m.content} />
            {m.trackingSetups && m.trackingSetups.length > 0 && (
              <div className={styles.cards}>
                {m.trackingSetups.map((s) => (
                  <SetupCard key={s.id} setup={s} onChange={setupChanged} onEdit={onEdit} showSymbol={!symbol} />
                ))}
              </div>
            )}
          </div>
        ),
      )}

      {busy && (
        <div className={styles.msgAssistant}>
          {live?.phase === 'writing' && live.text.trim() ? (
            <Markdown text={live.text} />
          ) : (
            <LiveStatus live={live} startedAt={startedAt} stopping={status === 'stopping'} />
          )}
        </div>
      )}

      {(status === 'error' || (status === 'stopped' && messages[messages.length - 1]?.role === 'user')) && (
        <div className={styles.notice}>
          <span>{status === 'error' ? notice ?? 'Claude gặp lỗi.' : 'Đã dừng trước khi Claude trả lời.'}</span>
          <button type="button" className={styles.btn} onClick={() => void retry()}>Thử lại</button>
        </div>
      )}
      {status === 'idle' && notice && <div className={styles.notice}>{notice}</div>}

      {convId && (
        <div className={styles.composer}>
          <textarea
            className={styles.textarea}
            rows={2}
            placeholder="Hỏi tiếp về phân tích này…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(input);
              }
            }}
          />
          {busy ? (
            <button type="button" className={styles.btn} onClick={() => void stop()}>Dừng</button>
          ) : (
            <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={!input.trim()} onClick={() => void send(input)}>Gửi</button>
          )}
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}

function LiveStatus({ live, startedAt, stopping }: { live: LiveReply | null; startedAt: number; stopping: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const label = stopping ? 'Đang dừng' : live?.phase === 'tool' && live.tool ? TOOL_LABEL[live.tool] ?? `Đang chạy ${live.tool}` : 'Đang suy nghĩ';
  return (
    <div className={styles.status} role="status">
      <span className={styles.spinner} aria-hidden />
      <span>{label}…</span>
      <span>{Math.max(0, Math.round((now - startedAt) / 1000))}s</span>
    </div>
  );
}

// ── Journal ──────────────────────────────────────────────────────────────────

function Journal({
  symbol,
  setups,
  events,
  onAdded,
}: {
  symbol: string;
  setups: TrackingSetup[];
  events: TrackingEvent[];
  onAdded: () => void;
}) {
  const [text, setText] = useState('');
  const [setupId, setSetupId] = useState('');
  const [images, setImages] = useState<ImageUploadValue>({ existingUrls: [], newFiles: [] });
  const [uploadKey, setUploadKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const label = (id: string | null) => {
    const s = setups.find((x) => x.id === id);
    return s ? `${s.direction} @${fmtPx(s.entryPrice)}` : null;
  };

  async function save() {
    if (!text.trim() && images.newFiles.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const urls = images.newFiles.length ? await api.uploadImages(images.newFiles, symbol) : [];
      await api.trackingAction('/notes', { symbol, setupId: setupId || null, message: text, images: urls });
      setText('');
      setImages({ existingUrls: [], newFiles: [] });
      setUploadKey((k) => k + 1);
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lưu ghi chú thất bại');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await api.trackingAction(`/notes/${id}`, {}, 'DELETE');
      onAdded();
    } catch {
      /* ignore */
    }
  }

  const shown = filter ? events.filter((e) => e.setupId === filter) : events;

  return (
    <>
      <div className={styles.noteForm}>
        <textarea className={styles.textarea} placeholder="Ghi chú (markdown) — quan sát, cảm xúc, lý do…" value={text} onChange={(e) => setText(e.target.value)} />
        <ImageUpload key={uploadKey} onChange={setImages} uploading={busy} />
        <div className={styles.row}>
          <select className={styles.select} value={setupId} onChange={(e) => setSetupId(e.target.value)}>
            <option value="">Ghi chú chung cho {symbol}</option>
            {setups.map((s) => (
              <option key={s.id} value={s.id}>Gắn vào setup {s.direction} @{fmtPx(s.entryPrice)} ({s.status})</option>
            ))}
          </select>
          <span className={styles.spacer} />
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy || (!text.trim() && images.newFiles.length === 0)} onClick={() => void save()}>
            {busy ? 'Đang lưu…' : 'Lưu ghi chú'}
          </button>
        </div>
        {error && <span className={styles.error}>{error}</span>}
      </div>

      {setups.length > 0 && (
        <div className={styles.row} style={{ marginTop: 10 }}>
          <span className={styles.hint}>Lọc:</span>
          <select className={styles.select} value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">Tất cả</option>
            {setups.map((s) => (
              <option key={s.id} value={s.id}>{s.direction} @{fmtPx(s.entryPrice)} ({s.status})</option>
            ))}
          </select>
        </div>
      )}

      <div className={styles.timeline}>
        {shown.length === 0 && <p className={styles.hint}>Chưa có sự kiện nào.</p>}
        {shown.map((e) => (
          <div key={e.id} className={styles.event}>
            <div>
              <div className={styles.eventTime}>{fmtDateTime(e.createdAt)}</div>
              <div className={styles.eventType}>{EVENT_LABEL[e.type] ?? e.type}</div>
            </div>
            <div>
              {e.setupId && label(e.setupId) && <div className={styles.hint}>Setup {label(e.setupId)}</div>}
              {e.type === 'ANALYSIS' || e.type === 'POSTMORTEM' || e.type === 'NOTE' ? (
                <details open={e.type !== 'ANALYSIS'}>
                  <summary className={styles.hint} style={{ cursor: 'pointer' }}>{e.type === 'ANALYSIS' ? 'Xem phân tích' : 'Nội dung'}</summary>
                  <Markdown text={e.message} />
                </details>
              ) : (
                <div className={styles.eventMsg}>{e.message}</div>
              )}
              {(e.chartUrl || (e.images?.length ?? 0) > 0) && (
                <div className={styles.eventImages}>
                  {e.chartUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className={`${styles.thumb} ${styles.chartThumb}`} src={e.chartUrl} alt="chart 4H" onClick={() => setLightbox(e.chartUrl)} />
                  )}
                  {e.images?.map((u) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={u} className={styles.thumb} src={u} alt="" onClick={() => setLightbox(u)} />
                  ))}
                </div>
              )}
              {e.type === 'NOTE' && (
                <button type="button" className={`${styles.btn} ${styles.btnDanger}`} style={{ marginTop: 6 }} onClick={() => void remove(e.id)}>
                  Xoá ghi chú
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {lightbox && <Lightbox url={lightbox} onClose={() => setLightbox(null)} />}
    </>
  );
}
