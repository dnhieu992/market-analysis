'use client';

import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { ChatMessage, LiveReply } from '@web/shared/api/types';
import { renderChatMarkdown } from '@web/shared/lib/chat-markdown';

import styles from './chat.module.css';

/* Claude-style chat pieces shared by the /skills chat page and the /tracking-coins coin panel. */

export { styles as chatStyles };

/** What the UI says while a tool runs — the reply itself streams in once Claude starts writing. */
export const TOOL_LABEL: Record<string, string> = {
  get_scalp_chart_data: 'Đang lấy nến 30m / 15m / 5m',
  analyze_market_structure: 'Đang phân tích cấu trúc thị trường',
  get_klines: 'Đang lấy dữ liệu nến',
  get_ticker_price: 'Đang lấy giá hiện tại',
  get_24h_ticker: 'Đang lấy thống kê 24h',
  propose_trade_setup: 'Đang tạo setup lệnh',
  get_tracking_coins: 'Đang đọc danh sách coin theo dõi',
  propose_swing_setup: 'Đang tạo setup swing',
};

export function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

// ── Icons ────────────────────────────────────────────────────────────────────

export const Icon = {
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

// ── Messages ─────────────────────────────────────────────────────────────────

export function CopyButton({ text }: { text: string }) {
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

export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => renderChatMarkdown(text), [text]);
  // eslint-disable-next-line react/no-danger
  return <div className={styles.prose} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function UserMessage({ msg }: { msg: ChatMessage }) {
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

export function AssistantMessage({
  msg,
  icon,
  isLast,
  children,
}: {
  msg: ChatMessage;
  icon: string;
  isLast: boolean;
  /** Cards rendered under the reply (trade setups, …). */
  children?: React.ReactNode;
}) {
  return (
    <div className={styles.assistantRow}>
      <div className={styles.avatar}>{icon}</div>
      <div className={styles.assistantBody}>
        <Markdown text={msg.content} />
        {children}
        <div className={`${styles.msgMeta} ${isLast ? styles.msgMetaVisible : ''}`}>
          <CopyButton text={msg.content} />
          <span className={styles.metaTime}>{fmtTime(msg.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}

/** The reply being generated: tool status, then the text streaming in with a caret. */
export function LiveMessage({ icon, live, startedAt, stopping }: { icon: string; live: LiveReply | null; startedAt: number; stopping: boolean }) {
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

export function Composer({
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

