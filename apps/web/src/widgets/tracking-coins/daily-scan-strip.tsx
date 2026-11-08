'use client';

import { useEffect, useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { SpotDailyScan } from '@web/shared/api/types';

import { fmtPx } from './setup-card';

const api = createApiClient();

const REGIME: Record<SpotDailyScan['regime'], string> = {
  BUY: 'A: mùa mua (top 100)',
  TOP50: 'A: chỉ top 50',
  NONE: 'A: không mở lệnh mới',
  UNKNOWN: 'A: thiếu dữ liệu breadth',
};

const vnDay = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const ddmm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' });

/**
 * One-glance result of the daily Strategy A / B scan (07:01 VN), under the page title: only what is
 * buyable, under which strategy, at which prices. Details → ask the chat.
 */
export function DailyScanStrip({ onPick }: { onPick?: (symbol: string) => void }) {
  const [scan, setScan] = useState<SpotDailyScan | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .fetchSpotDailyScan()
      .then(setScan)
      .catch(() => setError('Không tải được kết quả scan'))
      .finally(() => setLoaded(true));
  }, []);

  async function rerun() {
    setRunning(true);
    setError(null);
    try {
      setScan(await api.runSpotDailyScan());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Quét thất bại');
    } finally {
      setRunning(false);
    }
  }

  if (!loaded) return null;
  const stale = scan ? vnDay(scan.scannedAt) !== vnDay(new Date().toISOString()) : false;
  const sym = (s: string) => (
    <button type="button" className="tc-scan-sym" onClick={() => onPick?.(s)} title={`Lọc bảng theo ${s}`}>
      {s}
    </button>
  );

  return (
    <div className="tc-scan">
      <div className="tc-scan-meta">
        {scan ? (
          <>
            <span className={stale ? 'tc-scan-stale' : undefined}>
              Scan {hhmm(scan.scannedAt)} {ddmm(vnDay(scan.scannedAt))}
              {stale ? ' (cũ)' : ''}
            </span>
            <span>· breadth {scan.breadthPct ?? '—'}% → {REGIME[scan.regime]}</span>
            {scan.marketB && <span className="tc-scan-hot">· thị trường đang sập kiểu B</span>}
          </>
        ) : (
          <span>Chưa có scan — tự chạy lúc 07:00 mỗi sáng.</span>
        )}
        <button type="button" className="tc-scan-btn" onClick={() => void rerun()} disabled={running}>
          {running ? 'Đang quét…' : '↻ Quét lại'}
        </button>
      </div>

      {error && <div className="tc-scan-error">{error}</div>}

      {scan && (
        <ul className="tc-scan-list">
          {scan.a.map((x) => (
            <li key={`a-${x.symbol}`}>
              <span className="tc-scan-tag tc-scan-tag--a">A</span>
              {sym(x.symbol)}
              <span>
                mua {fmtPx(x.buy[0])} · {fmtPx(x.buy[1])} · {fmtPx(x.buy[2])}
              </span>
              <span className="tc-scan-dim">TP giá TB ×1.3</span>
            </li>
          ))}
          {scan.b.map((x) => (
            <li key={`b-${x.symbol}`}>
              <span className="tc-scan-tag tc-scan-tag--b">{x.level}</span>
              {sym(x.symbol)}
              <span className={`tc-scan-grade tc-scan-grade--${x.grade === 'CLIMAX' ? 'hi' : x.grade === 'RÂU' ? 'mid' : 'lo'}`}>{x.grade}</span>
              <span>
                mua {fmtPx(Math.min(x.entry, x.price))}–{fmtPx(x.maxEntry)} · TP {fmtPx(x.tp)} (+{x.tpPct}%)
              </span>
              <span className="tc-scan-dim">bán {ddmm(x.sellBy)} nếu chưa chạm</span>
            </li>
          ))}
          {scan.a.length === 0 && scan.b.length === 0 && <li className="tc-scan-dim">Không có coin mua được theo A / B.</li>}
        </ul>
      )}
    </div>
  );
}
