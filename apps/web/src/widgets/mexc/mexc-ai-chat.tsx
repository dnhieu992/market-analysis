'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type {
  MexcAiAction,
  MexcAiActionEdits,
  MexcPositionsResponse,
  ChatMessage,
  Conversation,
  LiveReply,
} from '@web/shared/api/types';
import { AssistantMessage, Composer, Icon, LiveMessage, UserMessage, chatStyles as c } from '@web/shared/ui/chat/chat-parts';

import styles from './mexc-ai-chat.module.css';

const api = createApiClient();

export const MEXC_AI_SKILL_ID = 'mexc-ai';
const ICON = '🤖';
const POLL_MS = 600;
const WATCH_TIMEOUT_MS = 8 * 60 * 1000;
const RESUME_WINDOW_MS = 10 * 60 * 1000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Status = 'idle' | 'waiting' | 'stopping' | 'error' | 'stopped';

const TYPE_LABEL: Record<MexcAiAction['type'], string> = {
  OPEN: 'Mở lệnh',
  DCA: 'DCA',
  SET_TP: 'Đặt TP',
  CLOSE: 'Đóng lệnh',
  CANCEL: 'Huỷ lệnh chờ',
};

const STATUS_LABEL: Record<MexcAiAction['status'], string> = {
  PROPOSED: 'Đề xuất',
  EXECUTED: 'Đã thực hiện',
  FAILED: 'Lỗi',
  DISMISSED: 'Bỏ qua',
};

const SUGGESTIONS: Record<'positions' | 'history' | 'setup', string[]> = {
  positions: [
    'Tóm tắt các vị thế đang mở: lệnh nào lãi/lỗ nhiều nhất, lệnh nào chưa có TP?',
    'Vị thế nào nên DCA hoặc dời TP lúc này?',
    'Đang dùng bao nhiêu % vốn làm ký quỹ? Có rủi ro thanh lý không?',
  ],
  history: [
    'Tuần này lãi lỗ thế nào? Coin nào hiệu quả nhất?',
    'So sánh LONG và SHORT trong lịch sử của tôi.',
    'Những lệnh lỗ gần đây có điểm chung gì?',
  ],
  setup: [
    'Coin nào trong Setup đang có điểm vào LONG đẹp nhất?',
    'Quét QQE H4 các coin 4–5 sao và đề xuất 1–2 lệnh nếu đủ điều kiện.',
    'Đang có lệnh BTC long nào không? Nếu có thì nên làm gì?',
  ],
};

export function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  return n.toLocaleString('en-US', { maximumFractionDigits: abs >= 1000 ? 2 : abs >= 1 ? 4 : 8 });
}

const fmtUsd = (n: number | null | undefined, d = 2) =>
  n == null || !Number.isFinite(n) ? '—' : `${n < 0 ? '−' : ''}$${Math.abs(n).toFixed(d)}`;
const fmtPct = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;

/** Floating 🤖 button + right-side chat panel on /mexc (clone of the /bitget AI chat). */
export function MexcAiChat({ tabLabel, onActionDone }: { tabLabel: string; onActionDone: () => void }) {
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
        <button type="button" className={styles.fab} onClick={() => setOpen(true)} aria-label="Mở MEXC AI" title="MEXC AI">
          <span aria-hidden>{ICON}</span>
          <span className={styles.fabLabel}>AI</span>
        </button>
      )}
      {open && (
        <>
          <div className={styles.backdrop} onClick={() => setOpen(false)} />
          <aside className={styles.panel} role="dialog" aria-label="MEXC AI">
            <AiThread tabLabel={tabLabel} onActionDone={onActionDone} onClose={() => setOpen(false)} />
          </aside>
        </>
      )}
    </>
  );
}

function AiThread({ tabLabel, onActionDone, onClose }: { tabLabel: string; onActionDone: () => void; onClose: () => void }) {
  const [convId, setConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [live, setLive] = useState<LiveReply | null>(null);
  const [startedAt, setStartedAt] = useState(Date.now());
  const [notice, setNotice] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [confirming, setConfirming] = useState<MexcAiAction | null>(null);
  const watchGen = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const busy = status === 'waiting' || status === 'stopping';
  const tabKey: keyof typeof SUGGESTIONS = tabLabel.startsWith('Lịch sử') ? 'history' : tabLabel.startsWith('Setup') ? 'setup' : 'positions';

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

  // One running thread: the newest mexc-ai conversation opens; "Bắt đầu lại" starts a fresh one.
  useEffect(() => {
    let cancelled = false;
    api
      .listConversations(MEXC_AI_SKILL_ID)
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
        const conv = await api.createConversation(`MEXC AI · ${date}`, MEXC_AI_SKILL_ID);
        id = conv.id;
        setConvId(id);
      }
      const saved = await api.sendMessage(id, content, `Tab: ${tabLabel}`);
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

  const actionChanged = useCallback((a: MexcAiAction) => {
    setMessages((prev) =>
      prev.map((m) => (m.mexcActions?.some((x) => x.id === a.id) ? { ...m, mexcActions: m.mexcActions.map((x) => (x.id === a.id ? a : x)) } : m)),
    );
  }, []);

  async function dismiss(a: MexcAiAction) {
    try {
      actionChanged(await api.dismissMexcAiAction(a.id));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Bỏ qua thất bại.');
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
      placeholder="Hỏi về tài khoản, hoặc nhờ đề xuất lệnh…"
      autoFocus
      inputRef={inputRef}
    />
  );

  return (
    <div className={`${c.embed} ${styles.thread}`}>
      <div className={styles.head}>
        <span className={styles.headIcon} aria-hidden>{ICON}</span>
        <div className={styles.headTitle}>
          MEXC AI
          <span className={styles.headSub}>Đang xem: {tabLabel}</span>
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
                <h1 className={c.greetingTitle}>MEXC AI</h1>
                <p className={c.greetingText}>
                  Đọc vị thế, lịch sử, Setup, nhật ký và chart của bạn. Mọi lệnh chỉ là thẻ đề xuất — bạn bấm xác nhận thì mới gửi lên sàn
                  (lệnh thật, chỉ TP, không SL).
                </p>
              </div>
              {composer}
              {notice && <div className={c.notice}>{notice}</div>}
              <div className={c.suggestions}>
                {SUGGESTIONS[tabKey].map((q) => (
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
                  {m.mexcActions && m.mexcActions.length > 0 && (
                    <div className={styles.cards}>
                      {m.mexcActions.map((a) => (
                        <ActionCard key={a.id} action={a} onConfirm={() => setConfirming(a)} onDismiss={() => { void dismiss(a); }} />
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

      {loaded && !showEmpty && (
        <div className={c.dock}>
          <div className={c.dockInner}>
            {composer}
            <div className={c.disclaimer}>Lệnh thật trên MEXC · chỉ gửi khi bạn bấm xác nhận trên thẻ · không có SL.</div>
          </div>
        </div>
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
    </div>
  );
}

// ── action card ──────────────────────────────────────────────────────────────

function summary(a: MexcAiAction): Array<[string, string]> {
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

function ActionCard({ action: a, onConfirm, onDismiss }: { action: MexcAiAction; onConfirm: () => void; onDismiss: () => void }) {
  const open = a.status === 'PROPOSED' || a.status === 'FAILED';
  return (
    <div className={`${styles.card} ${a.holdSide === 'short' ? styles.cardShort : ''} ${open ? '' : styles.cardDone}`}>
      <div className={styles.cardHead}>
        <span className={styles.cardType}>{TYPE_LABEL[a.type]}</span>
        <span className={styles.cardSymbol}>{a.symbol.replace(/USDT$/, '')}</span>
        <span className={a.holdSide === 'short' ? styles.short : styles.long}>{a.holdSide.toUpperCase()}</span>
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
          Đã gửi lên MEXC{a.decidedAt ? ` lúc ${new Date(a.decidedAt).toLocaleString('vi-VN')}` : ''}
          {a.orderId ? ` · orderId ${a.orderId}` : ''}
        </div>
      )}
      {open && (
        <div className={styles.actions}>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onConfirm}>
            {a.status === 'FAILED' ? 'Thử lại…' : 'Xác nhận…'}
          </button>
          <button type="button" className={styles.btn} onClick={onDismiss}>Bỏ qua</button>
        </div>
      )}
    </div>
  );
}

// ── confirm dialog ───────────────────────────────────────────────────────────

const num = (s: string) => {
  const n = Number(s.replace(',', '.'));
  return s.trim() === '' || !Number.isFinite(n) ? null : n;
};

function ConfirmDialog({ action: a, onClose, onDone }: { action: MexcAiAction; onClose: () => void; onDone: (a: MexcAiAction) => void }) {
  const p = a.params;
  const [acct, setAcct] = useState<MexcPositionsResponse | null>(null);
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>(p.orderType ?? 'MARKET');
  const [price, setPrice] = useState(p.price != null ? String(p.price) : '');
  const [margin, setMargin] = useState(p.marginUsd != null ? String(p.marginUsd) : '');
  const [leverage, setLeverage] = useState(p.leverage != null ? String(p.leverage) : '');
  const [tp, setTp] = useState(p.takeProfitPrice != null ? String(p.takeProfitPrice) : '');
  const [closePct, setClosePct] = useState(String(p.closePct ?? 100));
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.fetchMexcPositions().then(setAcct).catch(() => setAcct(null));
  }, []);

  const position = acct?.positions.find((x) => x.symbol === a.symbol && x.holdSide === a.holdSide) ?? null;
  const capital = acct?.initialCapitalUsd ?? null;
  const usedBefore = acct?.totalMarginUsd ?? null;
  const isEntry = a.type === 'OPEN' || a.type === 'DCA';
  const lev = position ? position.leverage : num(leverage) ?? 0;
  const marginN = num(margin) ?? 0;
  const entryPx = orderType === 'LIMIT' ? num(price) : position?.markPrice ?? p.refPrice ?? null;
  const addSize = isEntry && entryPx ? (marginN * lev) / entryPx : 0;
  const newAvg = position && isEntry && entryPx ? (position.size * position.entryPrice + addSize * entryPx) / (position.size + addSize) : null;
  const basis = newAvg ?? (position && !isEntry ? position.entryPrice : entryPx);
  const tpN = num(tp);
  const sideSign = a.holdSide === 'long' ? 1 : -1;
  const tpMovePct = tpN && basis ? ((tpN - basis) / basis) * 100 * sideSign : null;
  const totalSize = (position?.size ?? 0) + (isEntry ? addSize : 0);
  const tpProfit = tpN && basis ? (tpN - basis) * sideSign * totalSize : null;
  const closeShare = a.type === 'CLOSE' ? Math.min(100, Math.max(0, num(closePct) ?? 0)) / 100 : 0;
  const marginDelta = isEntry ? marginN : a.type === 'CLOSE' && position ? -position.marginUsd * closeShare : a.type === 'CANCEL' ? 0 : 0;
  const usedAfter = usedBefore != null ? usedBefore + marginDelta : null;
  const share = (m: number | null) => (m != null && capital ? (m / capital) * 100 : null);

  async function submit() {
    setErr(null);
    const edits: MexcAiActionEdits = {};
    if (isEntry) {
      edits.orderType = orderType;
      if (orderType === 'LIMIT') {
        if (!(num(price)! > 0)) return setErr('Nhập giá limit.');
        edits.price = num(price)!;
      }
      if (!(marginN > 0)) return setErr('Ký quỹ phải > 0.');
      edits.marginUsd = marginN;
      if (!position) {
        if (!(lev >= 1)) return setErr('Đòn bẩy phải ≥ 1.');
        edits.leverage = lev;
      }
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
      const res = await api.executeMexcAiAction(a.id, edits);
      if (res.status === 'FAILED') {
        setErr(res.error ?? 'MEXC từ chối lệnh.');
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
            {TYPE_LABEL[a.type]} {a.symbol.replace(/USDT$/, '')}{' '}
            <span className={a.holdSide === 'short' ? styles.short : styles.long}>{a.holdSide.toUpperCase()}</span>
          </strong>
          <button type="button" className={styles.close} onClick={onClose} disabled={sending} aria-label="Đóng">✕</button>
        </div>
        <div className={styles.warn}>⚠ Lệnh thật trên MEXC · không có SL</div>

        {position && (
          <div className={styles.posLine}>
            Vị thế hiện tại: size {fmtPrice(position.size)} · giá TB {fmtPrice(position.entryPrice)} · mark {fmtPrice(position.markPrice)} ·{' '}
            {position.leverage}× · ROE <span className={position.roePct >= 0 ? styles.pos : styles.neg}>{fmtPct(position.roePct)}</span>
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
                Đòn bẩy {position ? '(giữ của vị thế)' : ''}
                <input className={styles.input} inputMode="numeric" value={position ? String(position.leverage) : leverage} disabled={!!position} onChange={(e) => setLeverage(e.target.value)} />
              </label>
            </>
          )}
          {(isEntry || a.type === 'SET_TP') && (
            <label className={styles.full}>
              Take Profit {isEntry ? (orderType === 'LIMIT' ? '(MEXC đặt TP sau khi lệnh limit khớp)' : '(bỏ trống = không đặt)') : ''}
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
              <div>Notional ≈ {fmtUsd(marginN * lev)} · size thêm ≈ {fmtPrice(addSize)}</div>
              {newAvg != null && <div>Giá TB: {fmtPrice(position!.entryPrice)} → <strong>{fmtPrice(newAvg)}</strong></div>}
            </>
          )}
          {tpN != null && tpMovePct != null && (
            <div>
              TP {fmtPrice(tpN)}: <span className={tpMovePct >= 0 ? styles.pos : styles.neg}>{fmtPct(tpMovePct)}</span> từ {newAvg != null ? 'giá TB mới' : 'giá vào'} · lãi ước tính ≈ {fmtUsd(tpProfit, 3)} (chưa phí)
            </div>
          )}
          {a.type === 'CLOSE' && position && (
            <div>Chốt ≈ {fmtUsd(position.unrealizedPnlUsd * closeShare, 3)} PnL · giải phóng ≈ {fmtUsd(position.marginUsd * closeShare, 3)} ký quỹ</div>
          )}
          {a.type === 'CANCEL' && <div>Huỷ lệnh chờ orderId {p.orderId}</div>}
          <div>
            Ký quỹ đang dùng: {fmtUsd(usedBefore)} ({share(usedBefore)?.toFixed(1) ?? '—'}% vốn) → <strong>{fmtUsd(usedAfter)} ({share(usedAfter)?.toFixed(1) ?? '—'}% vốn)</strong>
            {capital ? ` · vốn gốc ${fmtUsd(capital)}` : ''}
            {isEntry && capital ? ` · thẻ này ${share(marginN)?.toFixed(1)}% vốn` : ''}
          </div>
        </div>

        {err && <div className={styles.error}>{err}</div>}
        <div className={styles.actions}>
          <span className={styles.spacer} />
          <button type="button" className={styles.btn} onClick={onClose} disabled={sending}>Huỷ</button>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => { void submit(); }} disabled={sending}>
            {sending ? 'Đang gửi…' : 'Xác nhận gửi lệnh'}
          </button>
        </div>
      </div>
    </>
  );
}
