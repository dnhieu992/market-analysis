'use client';

import { useEffect, useState } from 'react';
import type { TrackingCoinRow } from '@web/shared/api/types';

/*
 * ──────────────────────────────────────────────────────────────────────────
 *  TEMPORARILY DISABLED: AI LLM analysis of the current position.
 *
 *  The "Ask AI" button used to open a live chat drawer that auto-fired an
 *  LLM analysis of the coin (createConversation → sendMessage → poll reply).
 *  That feature is kept but disabled for now — see the commented block below.
 *
 *  New behavior: the button generates the full analysis prompt (with all the
 *  indicator data) and lets the user copy it, so they can paste it into an
 *  external LLM manually.
 *
 *  To re-enable the in-app AI chat, restore the commented imports/logic below
 *  and revert the render section to the original chat UI.
 * ──────────────────────────────────────────────────────────────────────────
 */

// import { useEffect, useRef } from 'react';
// import { createApiClient } from '@web/shared/api/client';
// import { renderMarkdown } from '@web/shared/lib/markdown';
// import type { ChatMessage } from '@web/shared/api/types';

type Props = {
  coin: TrackingCoinRow;
  livePrice: number | null;
  onClose: () => void;
};

// function TypingIndicator() {
//   return <div className="chat-typing"><span /><span /><span /></div>;
// }

// const STORAGE_KEY = (symbol: string) => `tracking-coin-chat:${symbol}`;

// ── Raw candle (OHLCV) fetching for CSV embedding ──────────────────────────
const CANDLE_TIMEFRAMES: { label: string; interval: string; limit: number }[] = [
  { label: 'D1', interval: '1d', limit: 100 },
  { label: 'H4', interval: '4h', limit: 100 },
  { label: 'M30', interval: '30m', limit: 80 },
];

type Kline = [number, string, string, string, string, string, ...unknown[]];

async function fetchKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance ${res.status} for ${symbol} ${interval}`);
  return res.json() as Promise<Kline[]>;
}

function fmtCandleTime(ms: number, interval: string): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  if (interval === '1d' || interval === '1w') return date;
  return `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

// Drop trailing zeros from Binance's fixed-decimal strings to keep the CSV compact.
const compactNum = (s: string) => Number(s).toString();

function buildCandleCsvSection(blocks: { label: string; interval: string; rows: Kline[] }[]): string {
  const lines: string[] = [];
  lines.push(``, `---`, ``);
  lines.push(`**Nến thô (OHLCV, giờ UTC)** — dùng để đọc cấu trúc giá / mẫu hình. Indicator ở trên đã được tính sẵn và là số liệu chuẩn; đừng tự tính lại indicator từ nến.`);
  for (const { label, interval, rows } of blocks) {
    lines.push(``);
    lines.push(`Nến ${label} (${interval}, ${rows.length} cây, cũ → mới):`);
    lines.push('```');
    lines.push('time,open,high,low,close,volume');
    for (const r of rows) {
      lines.push(`${fmtCandleTime(r[0], interval)},${compactNum(r[1])},${compactNum(r[2])},${compactNum(r[3])},${compactNum(r[4])},${compactNum(r[5])}`);
    }
    lines.push('```');
  }
  return lines.join('\n');
}

function buildInitialPrompt(coin: TrackingCoinRow, livePrice: number | null, candleSection: string): string {
  const sig = coin.signal;
  const name = coin.name ? `${coin.symbol} (${coin.name})` : coin.symbol;

  const lines: string[] = [
    `Hãy phân tích kỹ thuật coin ${name} dựa trên các chỉ báo hiện tại:`,
    ``,
  ];

  if (livePrice != null) {
    lines.push(`Giá hiện tại: $${livePrice.toLocaleString('en-US', { maximumFractionDigits: 6 })}`);
  }

  if (sig) {
    const trendLabel = (t: string) => ({ StrongUp: '↑↑ Strong Up', Up: '↑ Up', Neutral: '→ Neutral', Down: '↓ Down', StrongDown: '↓↓ Strong Down' }[t] ?? t);
    const boolLabel = (v: boolean | null) => v === null ? 'N/A' : v ? 'Yes' : 'No';

    lines.push(``);
    lines.push(`**Price Action Trend:**`);
    lines.push(`- D1: ${trendLabel(sig.trend)}`);
    lines.push(`- H4: ${trendLabel(sig.h4Trend)}`);
    lines.push(`- M30: ${trendLabel(sig.m30Trend)}`);
    lines.push(`- Swing Structure: ${sig.swingStructure}`);

    lines.push(``);
    lines.push(`**UT Bot (ATR=1, Key=3):**`);
    lines.push(`- D1: ${sig.utBotD1Bullish === null ? 'N/A' : sig.utBotD1Bullish ? 'Bullish' : 'Bearish'}`);
    lines.push(`- H4: ${sig.utBotH4Bullish === null ? 'N/A' : sig.utBotH4Bullish ? 'Bullish' : 'Bearish'}`);

    lines.push(``);
    lines.push(`**EMA (giá so với EMA):**`);
    lines.push(`- D1: EMA34 ${boolLabel(sig.ema34Above)}, EMA89 ${boolLabel(sig.ema89Above)}, EMA200 ${boolLabel(sig.ema200Above)}`);
    lines.push(`- H4: EMA34 ${boolLabel(sig.h4Ema34Above)}, EMA89 ${boolLabel(sig.h4Ema89Above)}, EMA200 ${boolLabel(sig.h4Ema200Above)}`);

    lines.push(``);
    lines.push(`**RSI (14):**`);
    lines.push(`- D1: ${sig.rsi != null ? sig.rsi.toFixed(1) : 'N/A'}`);
    lines.push(`- H4: ${sig.h4Rsi != null ? sig.h4Rsi.toFixed(1) : 'N/A'}`);

    lines.push(``);
    lines.push(`**Volume Ratio (so với MA20):**`);
    lines.push(`- D1: ${sig.volMultiplier != null ? sig.volMultiplier.toFixed(2) + 'x' : 'N/A'}`);
    lines.push(`- H4: ${sig.h4VolMultiplier != null ? sig.h4VolMultiplier.toFixed(2) + 'x' : 'N/A'}`);

    lines.push(``);
    lines.push(`Dữ liệu scan lúc: ${new Date(sig.scannedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`);
  }

  if (candleSection) {
    lines.push(candleSection);
  }

  lines.push(``, `---`, ``);
  lines.push(`Dựa trên các chỉ báo${candleSection ? ' và nến thô' : ''} ở trên, hãy:`);
  lines.push(`1. Đánh giá xu hướng tổng thể (bullish / bearish / neutral) và độ mạnh của xu hướng`);
  lines.push(`2. Phân tích sự đồng thuận/phân kỳ giữa D1 và H4`);
  lines.push(`3. Xác định các vùng giá quan trọng (support/resistance) cần chú ý`);
  lines.push(`4. Đưa ra khuyến nghị: nên watch để long / short / tránh / chờ xác nhận thêm`);

  return lines.join('\n');
}

export function TrackingCoinChatDrawer({ coin, livePrice, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const [candleSection, setCandleSection] = useState('');
  const [candleStatus, setCandleStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    setCandleStatus('loading');
    setCandleSection('');
    (async () => {
      try {
        const blocks = await Promise.all(
          CANDLE_TIMEFRAMES.map(async (tf) => ({
            label: tf.label,
            interval: tf.interval,
            rows: await fetchKlines(coin.symbol, tf.interval, tf.limit),
          }))
        );
        if (cancelled) return;
        setCandleSection(buildCandleCsvSection(blocks));
        setCandleStatus('ready');
      } catch {
        if (cancelled) return;
        setCandleStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [coin.symbol]);

  const prompt = buildInitialPrompt(coin, livePrice, candleSection);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      // Fallback for non-secure contexts / older browsers
      const ta = document.createElement('textarea');
      ta.value = prompt;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const sig = coin.signal;

  /*
   * ── DISABLED: in-app AI chat logic (kept for future re-enable) ────────────
   *
   * const [conversationId, setConversationId] = useState<string | null>(null);
   * const [messages, setMessages] = useState<ChatMessage[]>([]);
   * const [input, setInput] = useState('');
   * const [loading, setLoading] = useState(false);
   * const [initializing, setInitializing] = useState(true);
   * const messagesEndRef = useRef<HTMLDivElement>(null);
   * const pollingRef = useRef(false);
   *
   * useEffect(() => {
   *   return () => { pollingRef.current = false; };
   * }, []);
   *
   * useEffect(() => {
   *   void initConversation();
   *   // eslint-disable-next-line react-hooks/exhaustive-deps
   * }, [coin.symbol]);
   *
   * useEffect(() => {
   *   messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
   * }, [messages, loading]);
   *
   * async function pollForReply(convId: string, afterIso: string): Promise<void> {
   *   const TIMEOUT = 5 * 60 * 1000;
   *   const start = Date.now();
   *   while (pollingRef.current && Date.now() - start < TIMEOUT) {
   *     await new Promise<void>((res) => setTimeout(res, 2000));
   *     if (!pollingRef.current) break;
   *     try {
   *       const msgs = await createApiClient().getMessages(convId);
   *       const hasReply = msgs.some((m) => m.role === 'assistant' && m.createdAt >= afterIso);
   *       setMessages(msgs);
   *       if (hasReply) { pollingRef.current = false; setLoading(false); return; }
   *     } catch { (* ignore *) }
   *   }
   *   pollingRef.current = false;
   *   setLoading(false);
   * }
   *
   * async function initConversation() {
   *   pollingRef.current = false;
   *   setInitializing(true);
   *   const api = createApiClient();
   *   const storageKey = STORAGE_KEY(coin.symbol);
   *   const cachedId = localStorage.getItem(storageKey);
   *
   *   if (cachedId) {
   *     try {
   *       const existing = await api.getMessages(cachedId);
   *       setConversationId(cachedId);
   *       setMessages(existing);
   *       setInitializing(false);
   *       const lastMsg = existing[existing.length - 1];
   *       if (lastMsg?.role === 'user') {
   *         const age = Date.now() - new Date(lastMsg.createdAt).getTime();
   *         if (age < 10 * 60 * 1000) {
   *           setLoading(true);
   *           pollingRef.current = true;
   *           void pollForReply(cachedId, lastMsg.createdAt);
   *         }
   *       }
   *       return;
   *     } catch {
   *       localStorage.removeItem(storageKey);
   *     }
   *   }
   *
   *   try {
   *     const conv = await api.createConversation(`${coin.symbol} — Market Analysis`);
   *     localStorage.setItem(storageKey, conv.id);
   *     setConversationId(conv.id);
   *     setMessages([]);
   *     setInitializing(false);
   *
   *     const sentAt = new Date().toISOString();
   *     const optimistic: ChatMessage = {
   *       id: `optimistic-${Date.now()}`,
   *       conversationId: conv.id,
   *       role: 'user',
   *       content: prompt,
   *       createdAt: sentAt,
   *     };
   *     setMessages([optimistic]);
   *     setLoading(true);
   *     await api.sendMessage(conv.id, prompt);
   *     pollingRef.current = true;
   *     void pollForReply(conv.id, sentAt);
   *   } catch {
   *     setInitializing(false);
   *   }
   * }
   *
   * async function handleClear() {
   *   if (!conversationId) return;
   *   try { await createApiClient().deleteConversation(conversationId); } catch { (* ignore *) }
   *   localStorage.removeItem(STORAGE_KEY(coin.symbol));
   *   setConversationId(null);
   *   setMessages([]);
   *   void initConversation();
   * }
   *
   * async function handleSend() {
   *   const content = input.trim();
   *   if (!content || !conversationId || loading) return;
   *   setInput('');
   *   const sentAt = new Date().toISOString();
   *   const optimistic: ChatMessage = {
   *     id: `optimistic-${Date.now()}`,
   *     conversationId,
   *     role: 'user',
   *     content,
   *     createdAt: sentAt,
   *   };
   *   setMessages((prev) => [...prev, optimistic]);
   *   setLoading(true);
   *   try {
   *     await createApiClient().sendMessage(conversationId, content);
   *   } catch {
   *     setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
   *     setLoading(false);
   *     return;
   *   }
   *   pollingRef.current = true;
   *   void pollForReply(conversationId, sentAt);
   * }
   *
   * function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
   *   if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); }
   * }
   * ──────────────────────────────────────────────────────────────────────────
   */

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 999 }} />

      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(480px, 100vw)',
        background: '#ffffff',
        borderLeft: '1px solid #e5e7eb',
        display: 'flex', flexDirection: 'column',
        zIndex: 1000,
        boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
        color: '#111827',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '1rem 1.25rem',
          borderBottom: '1px solid #e5e7eb',
          background: '#f9fafb',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1rem', color: '#111827', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {coin.symbol}
              {coin.name && <span style={{ fontSize: '0.78rem', fontWeight: 400, color: '#6b7280' }}>{coin.name}</span>}
              <span style={{
                fontSize: '0.7rem', fontWeight: 600, padding: '0.15rem 0.45rem',
                borderRadius: '4px', background: '#ede9fe', color: '#6d28d9',
              }}>PROMPT</span>
            </div>
            <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.15rem', display: 'flex', gap: '0.75rem' }}>
              {livePrice != null && <span>Live: ${livePrice.toLocaleString('en-US', { maximumFractionDigits: 4 })}</span>}
              {sig && (
                <span>
                  D1 {sig.trend === 'StrongUp' ? '↑↑' : sig.trend === 'Up' ? '↑' : sig.trend === 'Neutral' ? '→' : sig.trend === 'Down' ? '↓' : '↓↓'}
                  {' · '}
                  H4 {sig.h4Trend === 'StrongUp' ? '↑↑' : sig.h4Trend === 'Up' ? '↑' : sig.h4Trend === 'Neutral' ? '→' : sig.h4Trend === 'Down' ? '↓' : '↓↓'}
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: '1.4rem', lineHeight: 1, padding: '0.25rem' }}>
              ✕
            </button>
          </div>
        </div>

        {/* Prompt body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', background: '#f9fafb' }}>
          <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>
            Prompt phân tích đã được tạo sẵn với đầy đủ chỉ báo + nến thô (OHLCV). Copy và dán vào AI bạn muốn dùng.
          </div>
          {candleStatus === 'loading' && (
            <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>⏳ Đang tải nến D1/H4/M30 từ Binance…</div>
          )}
          {candleStatus === 'error' && (
            <div style={{ fontSize: '0.75rem', color: '#b45309' }}>⚠ Không tải được nến — prompt chỉ gồm chỉ báo (không có OHLCV).</div>
          )}
          <textarea
            value={prompt}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
            style={{
              flex: 1, minHeight: '320px', resize: 'none',
              background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '10px',
              padding: '0.75rem 0.9rem', color: '#111827',
              fontSize: '0.8rem', lineHeight: 1.6, outline: 'none',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}
          />
        </div>

        {/* Copy action */}
        <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid #e5e7eb', background: '#ffffff', flexShrink: 0 }}>
          <button
            onClick={() => void handleCopy()}
            disabled={candleStatus === 'loading'}
            style={{
              width: '100%', padding: '0.7rem 1rem',
              background: copied ? '#16a34a' : '#4f46e5', color: '#fff',
              border: 'none', borderRadius: '10px',
              cursor: candleStatus === 'loading' ? 'not-allowed' : 'pointer',
              fontWeight: 600, fontSize: '0.9rem', transition: 'background 0.15s',
              opacity: candleStatus === 'loading' ? 0.5 : 1,
            }}
          >
            {candleStatus === 'loading' ? 'Đang tải nến…' : copied ? '✓ Đã copy prompt' : 'Copy prompt'}
          </button>
        </div>
      </div>
    </>
  );
}
