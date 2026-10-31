'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type {
  BitgetAiAction,
  BitgetAiActionEdits,
  BitgetPositionsResponse,
  ChatMessage,
  Conversation,
  LiveReply,
  TradingExchange,
} from '@web/shared/api/types';
import { AssistantMessage, Composer, Icon, LiveMessage, UserMessage, chatStyles as c } from '@web/shared/ui/chat/chat-parts';

// Cards, confirm dialog and header reuse the /bitget AI chat styles (the /mexc one is a copy of them).
import styles from '../bitget/bitget-ai-chat.module.css';
import { EXCHANGES, EXCHANGE_LABEL, EXCHANGE_SHORT } from './exchanges';
import tl from './trading-list.module.css';

const api = createApiClient();

export const TRADING_LIST_AI_SKILL_ID = 'trading-list-ai';
const ICON = '🤖';
const POLL_MS = 600;
const WATCH_TIMEOUT_MS = 8 * 60 * 1000;
const RESUME_WINDOW_MS = 10 * 60 * 1000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Status = 'idle' | 'waiting' | 'stopping' | 'error' | 'stopped';
/** /bitget and /mexc cards share one shape; the exchange says which API runs it. */
type Action = BitgetAiAction;
type Card = { ex: TradingExchange; action: Action };

const TYPE_LABEL: Record<Action['type'], string> = {
  OPEN: 'Mở lệnh',
  DCA: 'DCA',
  SET_TP: 'Đặt TP',
  CLOSE: 'Đóng lệnh',
  CANCEL: 'Huỷ lệnh chờ',
};

const STATUS_LABEL: Record<Action['status'], string> = {
  PROPOSED: 'Đề xuất',
  EXECUTED: 'Đã thực hiện',
  FAILED: 'Lỗi',
  DISMISSED: 'Bỏ qua',
};

const SUGGESTIONS = [
  'So sánh vị thế đang mở trên Bitget và MEXC: lệnh nào lãi/lỗ nhiều nhất, lệnh nào chưa có TP?',
  'Mỗi sàn đang dùng bao nhiêu % vốn làm ký quỹ? Có rủi ro thanh lý không?',
  'Coin 4–5 sao nào đang có điểm vào LONG swing đẹp nhất?',
  '@bitget quét QQE H4 các coin 4–5 sao và đề xuất 1–2 lệnh nếu đủ điều kiện.',
];

/** Exchanges offered by the @ menu; `keywords` lets "@bg" / "@mx" match too. */
const MENTIONS: Array<{ ex: TradingExchange; token: string; keywords: string[] }> = [
  { ex: 'bitget', token: '@bitget', keywords: ['bitget', 'bg'] },
  { ex: 'mexc', token: '@mexc', keywords: ['mexc', 'mx'] },
];

const api$ = {
  positions: (ex: TradingExchange): Promise<BitgetPositionsResponse> =>
    ex === 'bitget' ? api.fetchBitgetPositions() : api.fetchMexcPositions(),
  execute: (ex: TradingExchange, id: string, edits: BitgetAiActionEdits) =>
    ex === 'bitget' ? api.executeBitgetAiAction(id, edits) : api.executeMexcAiAction(id, edits),
  dismiss: (ex: TradingExchange, id: string) => (ex === 'bitget' ? api.dismissBitgetAiAction(id) : api.dismissMexcAiAction(id)),
};

function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  return n.toLocaleString('en-US', { maximumFractionDigits: abs >= 1000 ? 2 : abs >= 1 ? 4 : 8 });
}

const fmtUsd = (n: number | null | undefined, d = 2) =>
  n == null || !Number.isFinite(n) ? '—' : `${n < 0 ? '−' : ''}$${Math.abs(n).toFixed(d)}`;
const fmtPct = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;

function cardsOf(m: ChatMessage): Card[] {
  return [
    ...(m.bitgetActions ?? []).map((action) => ({ ex: 'bitget' as const, action })),
    ...(m.mexcActions ?? []).map((action) => ({ ex: 'mexc' as const, action })),
  ].sort((a, b) => a.action.createdAt.localeCompare(b.action.createdAt));
}

function ExTag({ ex }: { ex: TradingExchange }) {
  return (
    <span className={`${tl.exTag} ${tl[`ex_${ex}`]}`} title={EXCHANGE_LABEL[ex]}>
      {EXCHANGE_SHORT[ex]}
    </span>
  );
}

/**
 * Floating "AI" button of /trading-list; opens the chat as a slide-in panel,
 * same as the Bitget / MEXC AI on their pages.
 */
export function TradingListAiChat({ onActionDone }: { onActionDone: () => void }) {
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
        <button type="button" className={styles.fab} onClick={() => setOpen(true)} aria-label="Mở Trading List AI" title="Trading List AI">
          <span aria-hidden>{ICON}</span>
          <span className={styles.fabLabel}>AI</span>
        </button>
      )}
      {open && (
        <>
          <div className={styles.backdrop} onClick={() => setOpen(false)} />
          <aside className={styles.panel} role="dialog" aria-label="Trading List AI">
            <AiThread onActionDone={onActionDone} onClose={() => setOpen(false)} />
          </aside>
        </>
      )}
    </>
  );
}

/**
 * The /trading-list AI chat thread: one thread over both
 * accounts (skill `trading-list-ai`). Typing `@` offers @bitget / @mexc; the AI
 * asks back when an action names no exchange. Cards carry their exchange tag
 * and run through that exchange's confirm → execute endpoint.
 */
function AiThread({ onActionDone, onClose }: { onActionDone: () => void; onClose: () => void }) {
  const [convId, setConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [live, setLive] = useState<LiveReply | null>(null);
  const [startedAt, setStartedAt] = useState(Date.now());
  const [notice, setNotice] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [confirming, setConfirming] = useState<Card | null>(null);
  const [mention, setMention] = useState<{ start: number; query: string; index: number } | null>(null);
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

  // One running thread: the newest trading-list-ai conversation opens; "Bắt đầu lại" starts a fresh one.
  useEffect(() => {
    let cancelled = false;
    api
      .listConversations(TRADING_LIST_AI_SKILL_ID)
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
    setMention(null);
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
        const conv = await api.createConversation(`Trading List AI · ${date}`, TRADING_LIST_AI_SKILL_ID);
        id = conv.id;
        setConvId(id);
      }
      const saved = await api.sendMessage(id, content, 'Trang /trading-list (danh sách coin chung Bitget + MEXC)');
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

  const actionChanged = useCallback((ex: TradingExchange, a: Action) => {
    const field = ex === 'bitget' ? 'bitgetActions' : 'mexcActions';
    setMessages((prev) =>
      prev.map((m) => (m[field]?.some((x) => x.id === a.id) ? { ...m, [field]: m[field]!.map((x) => (x.id === a.id ? a : x)) } : m)),
    );
  }, []);

  async function dismiss({ ex, action }: Card) {
    try {
      actionChanged(ex, await api$.dismiss(ex, action.id));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Bỏ qua thất bại.');
    }
  }

  // ── @ mention: the token right before the caret drives the exchange menu ──
  const mentionOptions = mention
    ? MENTIONS.filter((o) => o.keywords.some((k) => k.startsWith(mention.query.toLowerCase())))
    : [];

  const syncMention = useCallback((value: string) => {
    const el = inputRef.current;
    const caret = el?.selectionStart ?? value.length;
    const query = /(?:^|\s)@([a-zA-Z]*)$/.exec(value.slice(0, caret))?.[1];
    setMention(query != null ? { start: caret - query.length - 1, query, index: 0 } : null);
  }, []);

  const pickMention = useCallback(
    (token: string) => {
      if (!mention) return;
      const el = inputRef.current;
      const caret = el?.selectionStart ?? input.length;
      const next = `${input.slice(0, mention.start)}${token} ${input.slice(caret).replace(/^\s+/, '')}`;
      const pos = mention.start + token.length + 1;
      setInput(next);
      setMention(null);
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(pos, pos);
      });
    },
    [input, mention],
  );

  /** Insert an exchange tag at the caret (the quick buttons under the composer). */
  const insertTag = useCallback(
    (token: string) => {
      const el = inputRef.current;
      const caret = el?.selectionStart ?? input.length;
      const before = input.slice(0, caret);
      const pad = before && !/\s$/.test(before) ? ' ' : '';
      const next = `${before}${pad}${token} ${input.slice(caret)}`;
      const pos = before.length + pad.length + token.length + 1;
      setInput(next);
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(pos, pos);
      });
    },
    [input],
  );

  // Capture phase: runs before the Composer's own Enter-to-send handler.
  const onKeyDownCapture = (e: React.KeyboardEvent) => {
    if (!mention || mentionOptions.length === 0) return;
    const n = mentionOptions.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      setMention({ ...mention, index: (mention.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n });
    } else if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      pickMention(mentionOptions[Math.min(mention.index, n - 1)]!.token);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setMention(null);
    }
  };

  const showEmpty = loaded && messages.length === 0 && !busy;
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;
  const composer = (
    <div className={tl.composerWrap} onKeyDownCapture={onKeyDownCapture}>
      {mention && mentionOptions.length > 0 && (
        <div className={tl.mentionMenu} role="listbox" aria-label="Chọn sàn">
          {mentionOptions.map((o, i) => (
            <button
              key={o.ex}
              type="button"
              role="option"
              aria-selected={i === mention.index}
              className={`${tl.mentionItem} ${i === mention.index ? tl.mentionItemActive : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                pickMention(o.token);
              }}
            >
              <ExTag ex={o.ex} />
              <strong>{o.token}</strong>
              <span className={tl.mentionHint}>{EXCHANGE_LABEL[o.ex]} USDT-M</span>
            </button>
          ))}
        </div>
      )}
      <Composer
        value={input}
        onChange={(v) => {
          setInput(v);
          syncMention(v);
        }}
        onSend={() => { void send(); }}
        onStop={() => { void stop(); }}
        busy={busy}
        placeholder="Hỏi về 2 tài khoản, hoặc nhờ đề xuất lệnh — gõ @ để chọn sàn…"
        autoFocus
        inputRef={inputRef}
      />
      <div className={tl.quickTags}>
        <span>Sàn:</span>
        {EXCHANGES.map((ex) => (
          <button key={ex} type="button" className={tl.quickTag} onClick={() => insertTag(`@${ex}`)}>
            <ExTag ex={ex} /> @{ex}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className={`${c.embed} ${styles.thread}`}>
      <div className={styles.head}>
        <span className={styles.headIcon} aria-hidden>{ICON}</span>
        <div className={styles.headTitle}>
          Trading List AI
          <span className={styles.headSub}>Đọc cả Bitget + MEXC · lệnh cần ghi rõ @sàn</span>
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
                <h1 className={c.greetingTitle}>Trading List AI</h1>
                <p className={c.greetingText}>
                  Đọc vị thế, lịch sử, Setup, nhật ký và chart của cả Bitget và MEXC. Muốn vào / đóng / huỷ lệnh thì ghi rõ{' '}
                  <strong>@bitget</strong> hoặc <strong>@mexc</strong> — không ghi thì AI sẽ hỏi lại. Mọi lệnh chỉ là thẻ đề xuất, bạn bấm
                  xác nhận mới gửi lên sàn (lệnh thật, chỉ TP, không SL).
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
            {messages.map((m) => {
              if (m.role === 'user') return <UserMessage key={m.id} msg={m} />;
              const cards = cardsOf(m);
              return (
                <AssistantMessage key={m.id} msg={m} icon={ICON} isLast={m.id === lastAssistantId && !busy}>
                  {cards.length > 0 && (
                    <div className={styles.cards}>
                      {cards.map((card) => (
                        <ActionCard
                          key={`${card.ex}-${card.action.id}`}
                          card={card}
                          onConfirm={() => setConfirming(card)}
                          onDismiss={() => { void dismiss(card); }}
                        />
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
            <div className={c.disclaimer}>Lệnh thật trên Bitget / MEXC · chỉ gửi khi bạn bấm xác nhận trên thẻ · không có SL.</div>
          </div>
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          card={confirming}
          onClose={() => setConfirming(null)}
          onDone={(a) => {
            actionChanged(confirming.ex, a);
            setConfirming(null);
            onActionDone();
          }}
        />
      )}
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

function ActionCard({ card: { ex, action: a }, onConfirm, onDismiss }: { card: Card; onConfirm: () => void; onDismiss: () => void }) {
  const open = a.status === 'PROPOSED' || a.status === 'FAILED';
  return (
    <div className={`${styles.card} ${a.holdSide === 'short' ? styles.cardShort : ''} ${open ? '' : styles.cardDone} ${tl[`cardEx_${ex}`]}`}>
      <div className={styles.cardHead}>
        <ExTag ex={ex} />
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
          Đã gửi lên {EXCHANGE_LABEL[ex]}{a.decidedAt ? ` lúc ${new Date(a.decidedAt).toLocaleString('vi-VN')}` : ''}
          {a.orderId ? ` · orderId ${a.orderId}` : ''}
        </div>
      )}
      {open && (
        <div className={styles.actions}>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onConfirm}>
            {a.status === 'FAILED' ? 'Thử lại…' : `Xác nhận trên ${EXCHANGE_LABEL[ex]}…`}
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

function ConfirmDialog({ card: { ex, action: a }, onClose, onDone }: { card: Card; onClose: () => void; onDone: (a: Action) => void }) {
  const p = a.params;
  const [acct, setAcct] = useState<BitgetPositionsResponse | null>(null);
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>(p.orderType ?? 'MARKET');
  const [price, setPrice] = useState(p.price != null ? String(p.price) : '');
  const [margin, setMargin] = useState(p.marginUsd != null ? String(p.marginUsd) : '');
  const [leverage, setLeverage] = useState(p.leverage != null ? String(p.leverage) : '');
  const [tp, setTp] = useState(p.takeProfitPrice != null ? String(p.takeProfitPrice) : '');
  const [closePct, setClosePct] = useState(String(p.closePct ?? 100));
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const name = EXCHANGE_LABEL[ex];

  useEffect(() => {
    api$.positions(ex).then(setAcct).catch(() => setAcct(null));
  }, [ex]);

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
  const marginDelta = isEntry ? marginN : a.type === 'CLOSE' && position ? -position.marginUsd * closeShare : 0;
  const usedAfter = usedBefore != null ? usedBefore + marginDelta : null;
  const share = (m: number | null) => (m != null && capital ? (m / capital) * 100 : null);

  async function submit() {
    setErr(null);
    const edits: BitgetAiActionEdits = {};
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
      const res = await api$.execute(ex, a.id, edits);
      if (res.status === 'FAILED') {
        setErr(res.error ?? `${name} từ chối lệnh.`);
        setSending(false);
        return;
      }
      onDone(res);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Thực hiện thất bại.');
      setSending(false);
    }
  }

  const tpLabel = isEntry
    ? ex === 'mexc' && orderType === 'LIMIT'
      ? '(MEXC đặt TP sau khi lệnh limit khớp)'
      : '(bỏ trống = không đặt)'
    : '';

  return (
    <>
      <div className={styles.modalBackdrop} onClick={() => !sending && onClose()} />
      <div className={styles.modal} role="dialog" aria-label="Xác nhận lệnh">
        <div className={styles.modalHead}>
          <strong>
            <ExTag ex={ex} /> {TYPE_LABEL[a.type]} {a.symbol.replace(/USDT$/, '')}{' '}
            <span className={a.holdSide === 'short' ? styles.short : styles.long}>{a.holdSide.toUpperCase()}</span>
          </strong>
          <button type="button" className={styles.close} onClick={onClose} disabled={sending} aria-label="Đóng">✕</button>
        </div>
        <div className={styles.warn}>⚠ Lệnh thật trên <strong>{name.toUpperCase()}</strong> · không có SL</div>

        {position && (
          <div className={styles.posLine}>
            Vị thế hiện tại ({name}): size {fmtPrice(position.size)} · giá TB {fmtPrice(position.entryPrice)} · mark {fmtPrice(position.markPrice)} ·{' '}
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
              Take Profit {tpLabel}
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
            Ký quỹ {name} đang dùng: {fmtUsd(usedBefore)} ({share(usedBefore)?.toFixed(1) ?? '—'}% vốn) → <strong>{fmtUsd(usedAfter)} ({share(usedAfter)?.toFixed(1) ?? '—'}% vốn)</strong>
            {capital ? ` · vốn gốc ${fmtUsd(capital)}` : ''}
            {isEntry && capital ? ` · thẻ này ${share(marginN)?.toFixed(1)}% vốn` : ''}
          </div>
        </div>

        {err && <div className={styles.error}>{err}</div>}
        <div className={styles.actions}>
          <span className={styles.spacer} />
          <button type="button" className={styles.btn} onClick={onClose} disabled={sending}>Huỷ</button>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => { void submit(); }} disabled={sending}>
            {sending ? 'Đang gửi…' : `Xác nhận gửi lệnh lên ${name}`}
          </button>
        </div>
      </div>
    </>
  );
}
