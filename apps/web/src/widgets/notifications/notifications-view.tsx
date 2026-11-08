'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { AppNotification, NotificationPage, TradingExchange } from '@web/shared/api/types';

import { notifyNotificationsChanged } from './use-unread-count';
import styles from './notifications.module.css';

const api = createApiClient();
const PAGE_SIZE = 30;
const REFRESH_MS = 20_000;

type ReadFilter = 'all' | 'unread';
type ExchangeFilter = 'all' | TradingExchange;

const EXCHANGE_LABEL: Record<TradingExchange, string> = { bitget: 'Bitget', mexc: 'MEXC' };

function relTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (diff < 60_000) return 'vừa xong';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} phút trước`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} giờ trước`;
  return `${Math.floor(diff / 86_400_000)} ngày trước`;
}

function absTime(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN', { hour12: false });
}

/** Tone of a row: green open, gold profitable close, red losing close / liquidation. */
function toneOf(n: AppNotification): string | undefined {
  const p = n.payload;
  if (!p) return styles.toneNeutral;
  if (p.action === 'liquidation') return styles.toneLoss;
  if (p.action === 'close') return (p.profit ?? 0) + (p.fee ?? 0) >= 0 ? styles.toneProfit : styles.toneLoss;
  return styles.toneOpen;
}

export function NotificationsView({ initial }: { initial: NotificationPage | null }) {
  const [items, setItems] = useState<AppNotification[]>(initial?.items ?? []);
  const [nextCursor, setNextCursor] = useState<string | null>(initial?.nextCursor ?? null);
  const [readFilter, setReadFilter] = useState<ReadFilter>('all');
  const [exchange, setExchange] = useState<ExchangeFilter>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initial ? null : 'Không tải được thông báo');
  const firstRender = useRef(true);

  const query = useCallback(
    (cursor?: string) =>
      api.fetchNotifications({
        cursor,
        limit: PAGE_SIZE,
        unread: readFilter === 'unread',
        exchange: exchange === 'all' ? undefined : exchange,
      }),
    [readFilter, exchange],
  );

  const reload = useCallback(async () => {
    try {
      const page = await query();
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setError(null);
    } catch {
      setError('Không tải được thông báo');
    }
  }, [query]);

  // Filters changed → reload from the top (the server snapshot covers the first render).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      if (initial) return;
    }
    setLoading(true);
    void reload().finally(() => setLoading(false));
  }, [reload, initial]);

  // Keep the first page live while the page is open (new fills land on top).
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void reload();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [reload]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoading(true);
    try {
      const page = await query(nextCursor);
      setItems((prev) => [...prev, ...page.items.filter((n) => !prev.some((p) => p.id === n.id))]);
      setNextCursor(page.nextCursor);
    } catch {
      setError('Không tải thêm được');
    } finally {
      setLoading(false);
    }
  };

  const markRead = async (n: AppNotification) => {
    if (n.readAt) return;
    const now = new Date().toISOString();
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: now } : x)));
    await api.markNotificationRead(n.id).catch(() => undefined);
    notifyNotificationsChanged();
  };

  const markAll = async () => {
    const now = new Date().toISOString();
    setItems((prev) => prev.map((x) => (x.readAt ? x : { ...x, readAt: now })));
    await api.markAllNotificationsRead().catch(() => undefined);
    notifyNotificationsChanged();
    if (readFilter === 'unread') void reload();
  };

  const unreadShown = items.filter((n) => !n.readAt).length;

  return (
    <div className={`page ${styles.page}`}>
      <div className={styles.head}>
        <h1>🔔 Thông báo</h1>
        <Link href="/trading-list" className={styles.link}>
          Mở Trading List →
        </Link>
      </div>
      <p className={styles.lead}>
        Mọi lệnh khớp trên tài khoản futures <strong>Bitget</strong> + <strong>MEXC</strong> (mở mới, DCA, chốt, TP/SL, thanh lý),
        một dòng cho mỗi lệnh, cũng được gửi qua Telegram. Cập nhật mỗi ~15 giây.
      </p>

      <div className={styles.toolbar}>
        <div className={styles.segment} role="group" aria-label="Lọc đã đọc">
          {(['all', 'unread'] as const).map((f) => (
            <button key={f} type="button" className={readFilter === f ? styles.segActive : ''} onClick={() => setReadFilter(f)}>
              {f === 'all' ? 'Tất cả' : 'Chưa đọc'}
            </button>
          ))}
        </div>
        <div className={styles.segment} role="group" aria-label="Lọc sàn">
          {(['all', 'bitget', 'mexc'] as const).map((f) => (
            <button key={f} type="button" className={exchange === f ? styles.segActive : ''} onClick={() => setExchange(f)}>
              {f === 'all' ? '2 sàn' : EXCHANGE_LABEL[f]}
            </button>
          ))}
        </div>
        <button type="button" className={styles.secondaryBtn} onClick={markAll} disabled={unreadShown === 0}>
          Đánh dấu đã đọc hết
        </button>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      {items.length === 0 && !loading && !error ? (
        <div className={styles.empty}>
          {readFilter === 'unread' ? 'Không có thông báo chưa đọc.' : 'Chưa có thông báo nào. Lệnh khớp tiếp theo sẽ hiện ở đây.'}
        </div>
      ) : (
        <ul className={styles.list}>
          {items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className={`${styles.item} ${toneOf(n) ?? ''} ${(n.readAt ? styles.read : styles.unread) ?? ''}`}
                onClick={() => void markRead(n)}
                title={n.readAt ? undefined : 'Bấm để đánh dấu đã đọc'}
              >
                <div className={styles.itemHead}>
                  {!n.readAt ? <span className={styles.dot} aria-label="chưa đọc" /> : null}
                  <span className={styles.title}>{n.title}</span>
                  <time className={styles.time} dateTime={n.eventAt} title={absTime(n.eventAt)}>
                    {relTime(n.eventAt)}
                  </time>
                </div>
                <div className={styles.body}>{n.body}</div>
                <div className={styles.meta}>
                  {absTime(n.eventAt)}
                  {n.payload?.revision && n.payload.revision > 1 ? ' · khớp thêm' : ''}
                  {n.telegramSent ? ' · ✓ Telegram' : ' · ✗ chưa gửi Telegram'}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {nextCursor ? (
        <div className={styles.more}>
          <button type="button" className={styles.secondaryBtn} onClick={() => void loadMore()} disabled={loading}>
            {loading ? 'Đang tải…' : 'Tải thêm'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
