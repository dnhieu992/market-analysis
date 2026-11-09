'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type {
  ChatMessage,
  Conversation,
  LiveReply,
  OkxAccount,
  OkxAiAction,
  OkxAiActionEdits,
  ShortScoreOverview,
  ShortSkill,
  ShortSkillVersion,
} from '@web/shared/api/types';
import { AssistantMessage, Composer, Icon, LiveMessage, Markdown, UserMessage, chatStyles as c } from '@web/shared/ui/chat/chat-parts';

// Panel, cards and confirm dialog reuse the /bitget AI chat styles.
import styles from '../bitget/bitget-ai-chat.module.css';
import s from './okx-short-ai-chat.module.css';

const api = createApiClient();

export const OKX_SHORT_AI_SKILL_ID = 'okx-short-ai';
const ICON = '🐻';
const POLL_MS = 600;
// A "/backtest" turn runs code in the sandbox — the server allows it 12 minutes.
const WATCH_TIMEOUT_MS = 13 * 60 * 1000;
const RESUME_WINDOW_MS = 14 * 60 * 1000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Status = 'idle' | 'waiting' | 'stopping' | 'error' | 'stopped';
type Action = OkxAiAction;
type View = 'chat' | 'history';

const TYPE_LABEL: Record<Action['type'], string> = {
  OPEN: 'Mở',
  DCA: 'DCA',
  SET_TP: 'Đặt TP',
  CLOSE: 'Đóng',
  CANCEL: 'Huỷ lệnh chờ',
};

// Fixed OKX order config (mirrors OKX_FIXED_LEVERAGE / OKX_DEFAULT_MARGIN_USD in the API).
const FIXED_LEVERAGE = 2;
const DEFAULT_MARGIN_USD = 5;

function SideTag({ side }: { side: Action['holdSide'] }) {
  return <span className={side === 'long' ? styles.long : styles.short}>{side === 'long' ? 'LONG' : 'SHORT'}</span>;
}

const STATUS_LABEL: Record<Action['status'], string> = {
  PROPOSED: 'Đề xuất',
  EXECUTED: 'Đã thực hiện',
  FAILED: 'Lỗi',
  DISMISSED: 'Bỏ qua',
};

const SUGGESTIONS = [
  'Chấm điểm short BTC hôm nay rồi tìm điểm vào swing (kháng cự H4 trở lên)',
  'Phân tích BTC: có setup LONG không? Vùng vào / TP?',
  'Các lệnh OKX đang mở thế nào? Lệnh nào chưa có TP?',
  'Phân tích BTC theo skill: có setup short không?',
  'Ghi note cho lệnh đang mở của ETH: ',
  'Review các lệnh OKX đã đóng gần đây — sai ở đâu?',
];

function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  return n.toLocaleString('en-US', { maximumFractionDigits: abs >= 1000 ? 2 : abs >= 1 ? 4 : 8 });
}
const fmtUsd = (n: number | null | undefined, d = 2) => (n == null || !Number.isFinite(n) ? '—' : `${n < 0 ? '−' : ''}$${Math.abs(n).toFixed(d)}`);
const fmtPct = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`);
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Floating "OKX AI" button of /trades; opens the OKX long/short chat as a slide-in panel. */
export function OkxShortAiChat({ onActionDone }: { onActionDone?: () => void }) {
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
        <button type="button" className={`${styles.fab} ${s.fab}`} onClick={() => setOpen(true)} aria-label="Mở OKX AI" title="OKX AI">
          <span aria-hidden>{ICON}</span>
          <span className={styles.fabLabel}>OKX AI</span>
        </button>
      )}
      {open && (
        <>
          <div className={styles.backdrop} onClick={() => setOpen(false)} />
          <aside className={styles.panel} role="dialog" aria-label="OKX AI">
            <AiThread onActionDone={onActionDone ?? (() => {})} onClose={() => setOpen(false)} />
          </aside>
        </>
      )}
    </>
  );
}

/**
 * The OKX short chat (skill `okx-short-ai`). Conversations are kept: the newest opens,
 * "Lịch sử" lists older ones to review; "Mới" starts a fresh one. The analysis skill is
 * edited from the chat (update_short_skill) or the Skill dialog — both apply next message.
 */
function AiThread({ onActionDone, onClose }: { onActionDone: () => void; onClose: () => void }) {
  const [view, setView] = useState<View>('chat');
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [convId, setConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [live, setLive] = useState<LiveReply | null>(null);
  const [startedAt, setStartedAt] = useState(Date.now());
  const [notice, setNotice] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [confirming, setConfirming] = useState<Action | null>(null);
  const [skillOpen, setSkillOpen] = useState(false);
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
    if (el && atBottomRef.current && view === 'chat') el.scrollTo({ top: el.scrollHeight });
  }, [messages, live?.text, live?.phase, status, view]);

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

  const openConversation = useCallback(
    async (id: string) => {
      watchGen.current += 1;
      setConvId(id);
      setMessages([]);
      setStatus('idle');
      setLive(null);
      setNotice(null);
      setView('chat');
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
        setNotice('Không tải được cuộc trò chuyện.');
      }
    },
    [watch],
  );

  const refreshConvs = useCallback(async () => {
    const all = await api.listConversations(OKX_SHORT_AI_SKILL_ID).catch(() => [] as Conversation[]);
    const sorted = [...all].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    setConvs(sorted);
    return sorted;
  }, []);

  // The newest conversation opens; older ones are in "Lịch sử".
  useEffect(() => {
    let cancelled = false;
    refreshConvs()
      .then(async (sorted) => {
        if (!cancelled && sorted[0]) await openConversation(sorted[0].id);
      })
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [refreshConvs, openConversation]);

  function startNew() {
    watchGen.current += 1;
    setConvId(null);
    setMessages([]);
    setStatus('idle');
    setLive(null);
    setNotice(null);
    setView('chat');
    setTimeout(() => inputRef.current?.focus(), 30);
  }

  async function removeConversation(id: string) {
    if (!window.confirm('Xoá cuộc trò chuyện này? Không khôi phục được.')) return;
    await api.deleteConversation(id).catch(() => {});
    if (id === convId) startNew();
    await refreshConvs();
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
        const conv = await api.createConversation(undefined, OKX_SHORT_AI_SKILL_ID);
        id = conv.id;
        setConvId(id);
      }
      const saved = await api.sendMessage(id, content, 'Trang /trades (bảng lệnh; lệnh OKX đồng bộ từ sàn mỗi 5 phút)');
      setMessages((prev) => prev.map((m) => (m.id === temp.id ? saved : m)));
      void refreshConvs();
      await watch(id, saved.createdAt);
      void refreshConvs();
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

  const actionChanged = useCallback((a: Action) => {
    setMessages((prev) => prev.map((m) => (m.okxActions?.some((x) => x.id === a.id) ? { ...m, okxActions: m.okxActions.map((x) => (x.id === a.id ? a : x)) } : m)));
  }, []);

  async function dismiss(a: Action) {
    try {
      actionChanged(await api.dismissOkxAiAction(a.id));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Bỏ qua thất bại.');
    }
  }

  const showEmpty = loaded && messages.length === 0 && !busy;
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;
  const title = convs.find((x) => x.id === convId)?.title;
  const composer = (
    <Composer
      value={input}
      onChange={setInput}
      onSend={() => { void send(); }}
      onStop={() => { void stop(); }}
      busy={busy}
      placeholder="Hỏi setup long / short, vào lệnh, ghi note, sửa skill, hoặc /backtest <chiến lược>…"
      autoFocus
      inputRef={inputRef}
    />
  );

  return (
    <div className={`${c.embed} ${styles.thread}`}>
      <div className={styles.head}>
        <span className={styles.headIcon} aria-hidden>{ICON}</span>
        <div className={styles.headTitle}>
          OKX AI
          <span className={styles.headSub}>{view === 'history' ? 'Lịch sử trò chuyện' : title ?? `Long + Short · cross ${FIXED_LEVERAGE}× · ký quỹ mặc định $${DEFAULT_MARGIN_USD} · lệnh cần xác nhận`}</span>
        </div>
        <button type="button" className={`${styles.headBtn} ${view === 'history' ? s.headBtnOn : ''}`} onClick={() => { setView(view === 'history' ? 'chat' : 'history'); void refreshConvs(); }} title="Xem lại các cuộc trò chuyện cũ">
          🕘 <span>Lịch sử</span>
        </button>
        <button type="button" className={styles.headBtn} onClick={() => setSkillOpen(true)} title="Xem / sửa skill phân tích">
          📘 <span>Skill</span>
        </button>
        <button type="button" className={styles.headBtn} onClick={startNew} disabled={busy || (!convId && messages.length === 0 && view === 'chat')} title="Cuộc trò chuyện mới">
          {Icon.compose} <span>Mới</span>
        </button>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Đóng">✕</button>
      </div>

      {view === 'chat' && <ScoreStrip busy={busy} />}

      {view === 'history' ? (
        <div className={`${c.scroller} ${s.history}`}>
          {convs.length === 0 ? (
            <p className={s.historyEmpty}>Chưa có cuộc trò chuyện nào.</p>
          ) : (
            <ul className={s.historyList}>
              {convs.map((cv) => (
                <li key={cv.id} className={`${s.historyItem} ${cv.id === convId ? s.historyItemOn : ''}`}>
                  <button type="button" className={s.historyOpen} onClick={() => { void openConversation(cv.id); }}>
                    <span className={s.historyTitle}>{cv.title}</span>
                    <span className={s.historyMeta}>{fmtDateTime(cv.updatedAt)}</span>
                  </button>
                  <button type="button" className={s.historyDel} onClick={() => { void removeConversation(cv.id); }} aria-label="Xoá" title="Xoá">
                    {Icon.trash}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          <div ref={scrollerRef} className={c.scroller} onScroll={onScroll}>
            {!loaded ? null : showEmpty ? (
              <div className={c.empty}>
                <div className={c.emptyInner}>
                  <div className={c.greeting}>
                    <div className={c.greetingIcon}>{ICON}</div>
                    <h1 className={c.greetingTitle}>OKX AI</h1>
                    <p className={c.greetingText}>
                      Phân tích điểm <strong>LONG / SHORT</strong> (short theo skill của bạn, long theo nguyên tắc chung), vào lệnh cross {FIXED_LEVERAGE}× · ký quỹ mặc định ${DEFAULT_MARGIN_USD}, đọc vị thế / lệnh chờ / lệnh OKX trong /trades, ghi note vào lệnh, và sửa
                      skill ngay trong chat (bấm <strong>Skill</strong> để xem / khôi phục bản cũ). Mọi lệnh chỉ là thẻ đề xuất — bấm xác nhận mới gửi lên OKX.
                    </p>
                  </div>
                  {composer}
                  {notice && <div className={c.notice}>{notice}</div>}
                  <div className={c.suggestions}>
                    {SUGGESTIONS.map((q) => (
                      <button
                        key={q}
                        type="button"
                        className={c.suggestion}
                        onClick={() => {
                          if (q.endsWith(': ')) {
                            setInput(q);
                            inputRef.current?.focus();
                          } else void send(q);
                        }}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className={c.thread}>
                {messages.map((m) => {
                  if (m.role === 'user') return <UserMessage key={m.id} msg={m} />;
                  const cards = [...(m.okxActions ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
                  return (
                    <AssistantMessage key={m.id} msg={m} icon={ICON} isLast={m.id === lastAssistantId && !busy}>
                      {cards.length > 0 && (
                        <div className={styles.cards}>
                          {cards.map((a) => (
                            <ActionCard key={a.id} action={a} onConfirm={() => setConfirming(a)} onDismiss={() => { void dismiss(a); }} />
                          ))}
                        </div>
                      )}
                    </AssistantMessage>
                  );
                })}
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
                <div className={c.disclaimer}>Lệnh thật trên OKX · long + short · cross {FIXED_LEVERAGE}× · chỉ gửi khi bạn bấm xác nhận trên thẻ.</div>
              </div>
            </div>
          )}
        </>
      )}

      {confirming && (
        <ConfirmDialog
          action={confirming}
          onClose={() => setConfirming(null)}
          onDone={(a) => {
            actionChanged(a);
            setConfirming(null);
            onActionDone();
          }}
        />
      )}
      {skillOpen && <SkillDialog onClose={() => setSkillOpen(false)} />}
    </div>
  );
}

// ── action card ──────────────────────────────────────────────────────────────

function summary(a: Action): Array<[string, string]> {
  const p = a.executedParams ?? a.params;
  switch (a.type) {
    case 'OPEN':
    case 'DCA':
      return [
        ['Lệnh', p.orderType === 'LIMIT' ? `LIMIT @ ${fmtPrice(p.price)}` : `MARKET ~${fmtPrice(p.refPrice)}`],
        ['Ký quỹ', `${fmtUsd(p.marginUsd)} · ${p.leverage ?? '—'}×`],
        ['TP', p.takeProfitPrice ? fmtPrice(p.takeProfitPrice) : 'chưa đặt'],
        ...(p.newAvg ? ([['Giá TB', `${fmtPrice(p.prevAvg)} → ${fmtPrice(p.newAvg)}`]] as Array<[string, string]>) : []),
      ];
    case 'SET_TP':
      return [
        ['TP', `${fmtPrice(p.prevTp)} → ${fmtPrice(p.takeProfitPrice)}`],
        ['Giá vào', fmtPrice(p.entry)],
        ['Giá hiện tại', fmtPrice(p.refPrice)],
      ];
    case 'CLOSE':
      return [
        ['Đóng', `${p.closePct ?? 100}%`],
        ['Giá hiện tại', fmtPrice(p.refPrice)],
        ['PnL vị thế', fmtUsd(p.pnlUsd, 3)],
      ];
    case 'CANCEL':
      return [
        ['Lệnh chờ', `@ ${fmtPrice(p.price)} · size ${p.size ?? '—'}`],
        ['Ký quỹ', fmtUsd(p.marginUsd)],
      ];
  }
}

function ActionCard({ action: a, onConfirm, onDismiss }: { action: Action; onConfirm: () => void; onDismiss: () => void }) {
  const open = a.status === 'PROPOSED' || a.status === 'FAILED';
  return (
    <div className={`${styles.card} ${a.holdSide === 'long' ? s.cardLong : styles.cardShort} ${open ? '' : styles.cardDone}`}>
      <div className={styles.cardHead}>
        <span className={s.exTag}>OKX</span>
        <span className={styles.cardType}>{TYPE_LABEL[a.type]}</span>
        <span className={styles.cardSymbol}>{a.symbol.replace(/USDT$/, '')}</span>
        <SideTag side={a.holdSide} />
        <span className={styles.spacer} />
        <span className={`${styles.badge} ${styles[`st${a.status}`]}`}>{STATUS_LABEL[a.status]}</span>
      </div>
      <div className={styles.levels}>
        {summary(a).map(([k, v]) => (
          <div key={k} className={styles.level}>
            <span className={styles.levelLabel}>{k}</span>
            <span className={styles.levelValue}>{v}</span>
          </div>
        ))}
      </div>
      {a.reason && <p className={styles.reason}>{a.reason}</p>}
      {a.status === 'FAILED' && a.error && <div className={styles.error}>Lỗi: {a.error}</div>}
      {a.status === 'EXECUTED' && (
        <div className={styles.meta}>
          Đã gửi lên OKX{a.decidedAt ? ` lúc ${new Date(a.decidedAt).toLocaleString('vi-VN')}` : ''}
          {a.orderId ? ` · ordId ${a.orderId}` : ''}
        </div>
      )}
      {open && (
        <div className={styles.actions}>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onConfirm}>
            {a.status === 'FAILED' ? 'Thử lại…' : 'Xác nhận trên OKX…'}
          </button>
          <button type="button" className={styles.btn} onClick={onDismiss}>Bỏ qua</button>
        </div>
      )}
    </div>
  );
}

// ── confirm dialog ───────────────────────────────────────────────────────────

const num = (v: string) => {
  const x = Number(v.replace(',', '.'));
  return v.trim() === '' || !Number.isFinite(x) ? null : x;
};

function ConfirmDialog({ action: a, onClose, onDone }: { action: Action; onClose: () => void; onDone: (a: Action) => void }) {
  const p = a.params;
  const [acct, setAcct] = useState<OkxAccount | null>(null);
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>(p.orderType ?? 'MARKET');
  const [price, setPrice] = useState(p.price != null ? String(p.price) : '');
  const [margin, setMargin] = useState(String(p.marginUsd ?? DEFAULT_MARGIN_USD));
  const [tp, setTp] = useState(p.takeProfitPrice != null ? String(p.takeProfitPrice) : '');
  const [closePct, setClosePct] = useState(String(p.closePct ?? 100));
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.fetchOkxAccount().then(setAcct).catch(() => setAcct(null));
  }, []);

  const isShort = a.holdSide !== 'long';
  const sideName = isShort ? 'short' : 'long';
  const position = acct?.positions.find((x) => x.symbol === a.symbol && x.holdSide === a.holdSide) ?? null;
  const isEntry = a.type === 'OPEN' || a.type === 'DCA';
  const lev = position ? position.leverage : FIXED_LEVERAGE;
  const marginN = num(margin) ?? 0;
  const entryPx = orderType === 'LIMIT' ? num(price) : position?.markPrice ?? p.refPrice ?? null;
  const addSize = isEntry && entryPx ? (marginN * lev) / entryPx : 0;
  const newAvg = position && isEntry && entryPx ? (position.size * position.entryPrice + addSize * entryPx) / (position.size + addSize) : null;
  const basis = newAvg ?? (position && !isEntry ? position.entryPrice : entryPx);
  const tpN = num(tp);
  const dir = isShort ? 1 : -1; // profit per unit = dir × (entry − exit)
  const tpMovePct = tpN && basis ? ((dir * (basis - tpN)) / basis) * 100 : null;
  const totalSize = (position?.size ?? 0) + (isEntry ? addSize : 0);
  const tpProfit = tpN && basis ? dir * (basis - tpN) * totalSize : null;
  const closeShare = a.type === 'CLOSE' ? Math.min(100, Math.max(0, num(closePct) ?? 0)) / 100 : 0;
  const equity = acct?.equityUsd ?? null;
  const share = (m: number | null) => (m != null && equity ? (m / equity) * 100 : null);
  const usedAfter = acct ? acct.totalMarginUsd + (isEntry ? marginN : a.type === 'CLOSE' && position ? -position.marginUsd * closeShare : 0) : null;

  async function submit() {
    setErr(null);
    const edits: OkxAiActionEdits = {};
    if (isEntry) {
      edits.orderType = orderType;
      if (orderType === 'LIMIT') {
        if (!(num(price)! > 0)) return setErr('Nhập giá limit.');
        edits.price = num(price)!;
      }
      if (!(marginN > 0)) return setErr('Ký quỹ phải > 0.');
      edits.marginUsd = marginN;
      if (tpN && entryPx && (isShort ? tpN >= entryPx : tpN <= entryPx)) return setErr(`TP của ${sideName} phải ${isShort ? 'thấp' : 'cao'} hơn giá vào.`);
      edits.takeProfitPrice = tpN && tpN > 0 ? tpN : null;
    } else if (a.type === 'SET_TP') {
      if (!(tpN && tpN > 0)) return setErr('Nhập giá TP.');
      edits.takeProfitPrice = tpN;
    } else if (a.type === 'CLOSE') {
      const pct = num(closePct);
      if (!(pct && pct >= 1 && pct <= 100)) return setErr('Tỉ lệ đóng 1–100%.');
      edits.closePct = pct;
    }
    setSending(true);
    try {
      const res = await api.executeOkxAiAction(a.id, edits);
      if (res.status === 'FAILED') {
        setErr(res.error ?? 'OKX từ chối lệnh.');
        setSending(false);
        return;
      }
      onDone(res);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Thực hiện thất bại.');
      setSending(false);
    }
  }

  return (
    <>
      <div className={styles.modalBackdrop} onClick={() => !sending && onClose()} />
      <div className={styles.modal} role="dialog" aria-label="Xác nhận lệnh">
        <div className={styles.modalHead}>
          <strong>
            <span className={s.exTag}>OKX</span> {TYPE_LABEL[a.type]} {a.symbol.replace(/USDT$/, '')} <SideTag side={a.holdSide} />
          </strong>
          <button type="button" className={styles.close} onClick={onClose} disabled={sending} aria-label="Đóng">✕</button>
        </div>
        <div className={styles.warn}>⚠ Lệnh thật trên <strong>OKX</strong> · cross margin · đòn bẩy cố định {FIXED_LEVERAGE}× cho vị thế mới</div>
        {acct?.canTrade === false && (
          <div className={styles.error}>API key OKX hiện chỉ có quyền đọc — OKX sẽ từ chối lệnh. Bật quyền Trade cho key (hoặc đặt OKX_TRADE_API_*) rồi restart API.</div>
        )}

        {position && (
          <div className={styles.posLine}>
            Vị thế hiện tại: size {fmtPrice(position.size)} · giá TB {fmtPrice(position.entryPrice)} · mark {fmtPrice(position.markPrice)} · {position.leverage}× · ROE{' '}
            <span className={position.roePct >= 0 ? styles.pos : styles.neg}>{fmtPct(position.roePct)}</span>
            {position.takeProfitPrice ? ` · TP ${fmtPrice(position.takeProfitPrice)}` : ' · chưa TP'}
            {position.liquidationPrice ? ` · liq ${fmtPrice(position.liquidationPrice)}` : ''}
          </div>
        )}

        <div className={styles.formGrid}>
          {isEntry && (
            <>
              <label>
                Loại lệnh
                <select className={styles.input} value={orderType} onChange={(e) => setOrderType(e.target.value as 'MARKET' | 'LIMIT')}>
                  <option value="MARKET">MARKET</option>
                  <option value="LIMIT">LIMIT</option>
                </select>
              </label>
              <label>
                Giá limit
                <input className={styles.input} inputMode="decimal" value={orderType === 'LIMIT' ? price : ''} disabled={orderType !== 'LIMIT'} placeholder={orderType === 'LIMIT' ? '' : `~${fmtPrice(entryPx)}`} onChange={(e) => setPrice(e.target.value)} />
              </label>
              <label>
                Ký quỹ (USDT)
                <input className={styles.input} inputMode="decimal" value={margin} onChange={(e) => setMargin(e.target.value)} />
              </label>
              <label>
                Đòn bẩy {position ? '(giữ của vị thế)' : '(cố định, cross)'}
                <input className={styles.input} inputMode="numeric" value={`${lev}×`} disabled readOnly />
              </label>
            </>
          )}
          {(isEntry || a.type === 'SET_TP') && (
            <label className={styles.full}>
              Take Profit {isEntry ? (position && orderType === 'LIMIT' ? '(vị thế đang mở: dời TP bằng thẻ Đặt TP sau khi khớp)' : '(bỏ trống = không đặt)') : ''}
              <input className={styles.input} inputMode="decimal" value={tp} onChange={(e) => setTp(e.target.value)} />
            </label>
          )}
          {a.type === 'CLOSE' && (
            <label className={styles.full}>
              Đóng bao nhiêu % vị thế
              <input className={styles.input} inputMode="numeric" value={closePct} onChange={(e) => setClosePct(e.target.value)} />
            </label>
          )}
        </div>

        <div className={styles.preview}>
          {isEntry && (
            <>
              <div>Notional ≈ {fmtUsd(marginN * lev)} · size thêm ≈ {fmtPrice(addSize)} (làm tròn xuống theo lot của OKX)</div>
              {newAvg != null && <div>Giá TB: {fmtPrice(position!.entryPrice)} → <strong>{fmtPrice(newAvg)}</strong></div>}
            </>
          )}
          {tpN != null && tpMovePct != null && (
            <div>
              TP {fmtPrice(tpN)}: <span className={tpMovePct >= 0 ? styles.pos : styles.neg}>{fmtPct(tpMovePct)}</span> từ {newAvg != null ? 'giá TB mới' : 'giá vào'} · lãi ước tính ≈ {fmtUsd(tpProfit, 3)} (chưa phí)
            </div>
          )}
          {a.type === 'CLOSE' && position && <div>Chốt ≈ {fmtUsd(position.unrealizedPnlUsd * closeShare, 3)} PnL · giải phóng ≈ {fmtUsd(position.marginUsd * closeShare, 3)} ký quỹ</div>}
          {a.type === 'CANCEL' && <div>Huỷ lệnh chờ ordId {p.orderId}</div>}
          {acct && (
            <div>
              Ký quỹ đang dùng: {fmtUsd(acct.totalMarginUsd)} ({share(acct.totalMarginUsd)?.toFixed(1) ?? '—'}% equity) → <strong>{fmtUsd(usedAfter)} ({share(usedAfter)?.toFixed(1) ?? '—'}% equity)</strong>
              {equity ? ` · equity ${fmtUsd(equity)}` : ''}
              {acct.availableUsd != null ? ` · khả dụng ${fmtUsd(acct.availableUsd)}` : ''}
            </div>
          )}
        </div>

        {err && <div className={styles.error}>{err}</div>}
        <div className={styles.actions}>
          <span className={styles.spacer} />
          <button type="button" className={styles.btn} onClick={onClose} disabled={sending}>Huỷ</button>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => { void submit(); }} disabled={sending}>
            {sending ? 'Đang gửi…' : 'Xác nhận gửi lệnh lên OKX'}
          </button>
        </div>
      </div>
    </>
  );
}

// ── skill dialog ─────────────────────────────────────────────────────────────

/** View / edit the analysis skill and its versions. A save or a restore applies to the next chat message. */
function SkillDialog({ onClose }: { onClose: () => void }) {
  const [skill, setSkill] = useState<ShortSkill | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [viewing, setViewing] = useState<ShortSkillVersion | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSkill(await api.fetchOkxShortSkill());
    } catch {
      setErr('Không tải được skill.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api.updateOkxShortSkill(draft, note.trim() || undefined);
      setEditing(false);
      setNote('');
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Lưu thất bại.');
    } finally {
      setBusy(false);
    }
  }

  async function restore(version: number) {
    if (!window.confirm(`Khôi phục skill về v${version}? (lưu thành version mới)`)) return;
    setBusy(true);
    setErr(null);
    try {
      await api.restoreOkxShortSkill(version);
      setViewing(null);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Khôi phục thất bại.');
    } finally {
      setBusy(false);
    }
  }

  async function view(version: number) {
    try {
      setViewing(await api.fetchOkxShortSkillVersion(version));
    } catch {
      setErr(`Không tải được v${version}.`);
    }
  }

  const shown = viewing ?? (skill ? { version: skill.version, content: skill.content } : null);

  return (
    <>
      <div className={styles.modalBackdrop} onClick={() => !busy && onClose()} />
      <div className={`${styles.modal} ${s.skillModal}`} role="dialog" aria-label="Skill phân tích">
        <div className={styles.modalHead}>
          <strong>📘 Skill phân tích short</strong>
          <button type="button" className={styles.close} onClick={onClose} disabled={busy} aria-label="Đóng">✕</button>
        </div>
        {!skill ? (
          <p className={styles.meta}>{err ?? 'Đang tải…'}</p>
        ) : (
          <>
            <div className={styles.meta}>
              {skill.isDefault ? 'Đang dùng bản mặc định (chưa lưu version nào).' : `Đang dùng v${skill.version} · ${fmtDateTime(skill.updatedAt!)}`} Sửa ở đây hoặc nhờ AI trong chat — áp dụng
              từ tin nhắn tiếp theo, không cần deploy.
            </div>
            {editing ? (
              <>
                <textarea className={`${styles.input} ${s.skillText}`} value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
                <input className={styles.input} placeholder="Ghi chú thay đổi (tuỳ chọn)" value={note} onChange={(e) => setNote(e.target.value)} />
              </>
            ) : (
              shown && (
                <div className={s.skillView}>
                  {viewing && (
                    <div className={s.skillViewHead}>
                      Đang xem v{viewing.version}
                      {viewing.version !== skill.version && (
                        <button type="button" className={styles.btn} onClick={() => { void restore(viewing.version); }} disabled={busy}>
                          Khôi phục bản này
                        </button>
                      )}
                      <button type="button" className={styles.btn} onClick={() => setViewing(null)}>Về bản hiện tại</button>
                    </div>
                  )}
                  <Markdown text={shown.content} />
                </div>
              )
            )}
            {err && <div className={styles.error}>{err}</div>}
            <div className={styles.actions}>
              {editing ? (
                <>
                  <span className={styles.spacer} />
                  <button type="button" className={styles.btn} onClick={() => setEditing(false)} disabled={busy}>Huỷ</button>
                  <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => { void save(); }} disabled={busy || draft.trim().length < 20}>
                    {busy ? 'Đang lưu…' : 'Lưu version mới'}
                  </button>
                </>
              ) : (
                <>
                  <span className={styles.spacer} />
                  <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => { setDraft(skill.content); setViewing(null); setEditing(true); }}>
                    Sửa skill
                  </button>
                </>
              )}
            </div>
            {skill.history.length > 0 && !editing && (
              <div className={s.versions}>
                <div className={styles.levelLabel}>Lịch sử version</div>
                <ul>
                  {skill.history.map((h) => (
                    <li key={h.version}>
                      <button type="button" className={s.versionBtn} onClick={() => { void view(h.version); }}>
                        <strong>v{h.version}</strong>
                        {h.version === skill.version && <span className={s.current}>hiện tại</span>}
                        <span>{h.author === 'LLM' ? '🤖 AI' : '👤 Bạn'}</span>
                        <span className={s.versionNote}>{h.note ?? '—'}</span>
                        <span className={s.versionTime}>{fmtDateTime(h.createdAt)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

/**
 * Latest BTC SHORT checklist score (cron 12:05 VN, or scored from the chat). Criteria are edited by
 * asking the chat ("thêm tiêu chí…"); this strip only shows the result and can re-score now.
 */
function ScoreStrip({ busy }: { busy: boolean }) {
  const [data, setData] = useState<ShortScoreOverview | null>(null);
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    api.fetchShortScore().then(setData).catch(() => setData(null));
  }, []);
  // initial load + after every finished reply (the chat may have re-scored or edited the criteria)
  useEffect(() => {
    if (!busy) load();
  }, [busy, load]);

  const rescore = async () => {
    setRunning(true);
    setErr(null);
    try {
      await api.runShortScore();
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const l = data?.latest;
  const tone = !l ? '' : l.scorePct >= 60 ? s.scoreHigh : l.scorePct >= 40 ? s.scoreMid : s.scoreLow;
  return (
    <div className={s.score}>
      <div className={s.scoreRow}>
        <button type="button" className={s.scoreMain} onClick={() => setOpen((o) => !o)} disabled={!l} title="Xem từng tiêu chí">
          🎯 {l ? (
            <>
              <span>{l.symbol.replace('USDT', '')} short</span>
              <strong className={`${s.scorePct} ${tone}`}>{l.scorePct}%</strong>
              <span className={s.scoreMeta}>
                {l.hitPoints}/{l.maxPoints} điểm · {fmtDateTime(l.takenAt)} · tiêu chí v{l.criteriaVersion}
              </span>
              <span className={s.scoreCaret}>{open ? '▴' : '▾'}</span>
            </>
          ) : (
            <span className={s.scoreMeta}>Chưa có điểm short — bấm “Chấm lại” hoặc hỏi chat</span>
          )}
        </button>
        <button type="button" className={s.scoreBtn} onClick={() => { void rescore(); }} disabled={running} title="Chấm lại với dữ liệu hiện tại">
          {running ? '…' : '↻ Chấm lại'}
        </button>
      </div>
      {err && <div className={s.scoreErr}>{err}</div>}
      {open && l && (
        <ul className={s.scoreList}>
          {l.criteria.map((c) => (
            <li key={c.id} className={s.scoreItem}>
              <span aria-hidden>{c.error ? '⚠️' : c.hit ? '✅' : '❌'}</span>
              <span className={s.scoreLabel}>
                {c.label} <em>+{c.points}</em>
                <small>{c.error ? `Lỗi: ${c.error}` : c.detail}</small>
              </span>
            </li>
          ))}
          {data && data.recent.length > 1 && (
            <li className={s.scoreRecent}>
              Gần đây: {data.recent.slice(0, 7).map((r) => `${r.takenAt.slice(5, 10)} ${r.scorePct}%`).join(' · ')}
            </li>
          )}
          <li className={s.scoreHint}>Muốn thêm / sửa tiêu chí: nhắn chat, vd “thêm tiêu chí funding &gt; 0.01% +1 điểm”.</li>
        </ul>
      )}
    </div>
  );
}
