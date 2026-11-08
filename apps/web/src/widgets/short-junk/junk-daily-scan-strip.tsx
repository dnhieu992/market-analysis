'use client';

import { useEffect, useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { JunkShortDailyScan } from '@web/shared/api/types';

const api = createApiClient();

const vnDay = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const ddmm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' });
const px = (n: number) => n.toLocaleString('en-US', { maximumSignificantDigits: 5 });

const ACTION: Record<JunkShortDailyScan['short'][number]['action'], { label: string; tone: 'hi' | 'mid' | 'lo' }> = {
  SHORT: { label: 'Short', tone: 'hi' },
  HALF: { label: '½ size', tone: 'mid' },
  WATCH: { label: 'Theo dõi', tone: 'lo' },
};

/**
 * One-glance result of the daily short-junk scan (07:02 VN), under the page title: which listed coins
 * can be shorted today, by which setup, at which ladder. Details → ask the 🗑️ AI chat.
 */
export function JunkDailyScanStrip() {
  const [scan, setScan] = useState<JunkShortDailyScan | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .fetchJunkShortDailyScan()
      .then(setScan)
      .catch(() => setError('Không tải được kết quả scan'))
      .finally(() => setLoaded(true));
  }, []);

  async function rerun() {
    setRunning(true);
    setError(null);
    try {
      setScan(await api.runJunkShortDailyScan());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Quét thất bại');
    } finally {
      setRunning(false);
    }
  }

  if (!loaded) return null;
  const stale = scan ? vnDay(scan.scannedAt) !== vnDay(new Date().toISOString()) : false;

  return (
    <div className="tc-scan">
      <div className="tc-scan-meta">
        {scan ? (
          <>
            <span className={stale ? 'tc-scan-stale' : undefined}>
              Scan {hhmm(scan.scannedAt)} {ddmm(vnDay(scan.scannedAt))}
              {stale ? ' (cũ)' : ''} · {scan.coins} coin
            </span>
            {scan.coins > 0 && (
              <span className={scan.btc.bear ? undefined : 'tc-scan-hot'}>
                · BTC D1 {scan.btc.bear ? 'dưới' : 'trên'} EMA50 → {scan.btc.bear ? 'A + B' : 'chỉ A, edge yếu hơn'}
              </span>
            )}
          </>
        ) : (
          <span>Chưa có scan — tự chạy lúc 07:02 mỗi sáng.</span>
        )}
        <button type="button" className="tc-scan-btn" onClick={() => void rerun()} disabled={running}>
          {running ? 'Đang quét…' : '↻ Quét lại'}
        </button>
      </div>

      {error && <div className="tc-scan-error">{error}</div>}

      {scan && (
        <ul className="tc-scan-list">
          {scan.short.map((x) => {
            const act = ACTION[x.action];
            return (
              <li key={`s-${x.symbol}`}>
                <span className={`tc-scan-tag tc-scan-tag--${x.setup === 'A' ? 'a' : 'b'}`}>{x.setup}</span>
                <b>{x.symbol}</b>
                <span className={`tc-scan-grade tc-scan-grade--${act.tone}`}>{act.label}</span>
                {x.setup === 'A' && <span className="tc-scan-dim">+{x.pump3dPct}%/3D</span>}
                <span>
                  short {x.entries.map(px).join(' · ')} · stop {px(x.stop)} · TP TB −{x.tpPct}%
                </span>
                <span className="tc-scan-dim">{x.days} ngày</span>
                {x.flags.length > 0 && <span className="tc-scan-hot">⚠ {x.flags.join(', ')}</span>}
              </li>
            );
          })}
          {scan.watch.length > 0 && (
            <li className="tc-scan-dim">
              Theo dõi (+30–50%/3D): {scan.watch.map((w) => `${w.symbol} +${w.pump3dPct}%`).join(' · ')}
            </li>
          )}
          {scan.short.length === 0 && scan.watch.length === 0 && (
            <li className="tc-scan-dim">{scan.coins === 0 ? 'Danh sách trống — thêm coin để scan.' : 'Không có coin short được theo A / B hôm nay.'}</li>
          )}
          {scan.notOnFutures.length > 0 && <li className="tc-scan-dim">Không có perp Binance: {scan.notOnFutures.join(', ')}</li>}
        </ul>
      )}
    </div>
  );
}
