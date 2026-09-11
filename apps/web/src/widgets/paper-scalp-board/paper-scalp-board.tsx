'use client';

import { useEffect, useState } from 'react';

import { createApiClient } from '@web/shared/api/client';
import type { ScalpPaperTrade, ScalpPaperTradeBoard as BoardData } from '@web/shared/api/types';

const apiClient = createApiClient();

/** The monitor checks every 15 minutes; refreshing faster only re-reads the same row. */
const REFRESH_MS = 30_000;

const STATUS_LABEL: Record<ScalpPaperTrade['status'], string> = {
  PENDING: 'Chờ khớp',
  OPEN: 'Đang mở',
  CLOSED_TP: 'Chạm TP',
  CLOSED_SL: 'Dính SL',
  CLOSED_EARLY: 'Claude cắt sớm',
  CANCELLED: 'Đã huỷ (chưa khớp)',
};

const STATUS_COLOR: Record<ScalpPaperTrade['status'], string> = {
  PENDING: '#7c3aed',
  OPEN: '#2563eb',
  CLOSED_TP: '#16a34a',
  CLOSED_SL: '#dc2626',
  CLOSED_EARLY: '#d97706',
  CANCELLED: '#6b7280',
};

function fmtUsd(n: number | null): string {
  if (n == null) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}$`;
}

function fmtR(n: number | null): string {
  if (n == null) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}R`;
}

function fmtPrice(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
}

function StatTile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '12px 16px', minWidth: 140 }}>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: color ?? '#111827' }}>{value}</div>
    </div>
  );
}

function PendingOrderCard({ order, livePrice }: { order: ScalpPaperTrade; livePrice: number | null }) {
  const isLong = order.direction === 'LONG';
  const distancePct =
    livePrice != null ? ((order.entryPrice - livePrice) / livePrice) * 100 : null;

  return (
    <div style={{ background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: 12, padding: 20, marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#7c3aed', textTransform: 'uppercase' }}>
          Lệnh limit chờ khớp — {isLong ? 'LONG' : 'SHORT'} {order.symbol}
        </span>
        <div style={{ fontSize: 13, color: '#6b7280' }}>Giá hiện tại: {livePrice != null ? fmtPrice(livePrice) : '—'}</div>
      </div>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 14 }}>
        <div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Giá limit</div>
          <div style={{ fontWeight: 600 }}>{fmtPrice(order.entryPrice)}</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Stop Loss</div>
          <div style={{ fontWeight: 600 }}>{fmtPrice(order.stopLoss)}</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Take Profit</div>
          <div style={{ fontWeight: 600 }}>{fmtPrice(order.takeProfit)}</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>R:R kế hoạch</div>
          <div style={{ fontWeight: 600 }}>1:{order.rrPlanned.toFixed(2)}</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Cách giá hiện tại</div>
          <div style={{ fontWeight: 600 }}>{distancePct != null ? `${distancePct > 0 ? '+' : ''}${distancePct.toFixed(2)}%` : '—'}</div>
        </div>
      </div>

      <div style={{ fontSize: 13, color: '#4b5563', marginTop: 12, lineHeight: 1.5 }}>
        <strong>Lý do đặt lệnh:</strong> {order.reasoning}
      </div>
      {order.lastNote && (
        <div style={{ fontSize: 13, color: '#5b21b6', marginTop: 8, lineHeight: 1.5, background: '#f3e8ff', padding: '8px 10px', borderRadius: 8 }}>
          <strong>Nhận định mới nhất:</strong> {order.lastNote}
        </div>
      )}
      <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 8 }}>
        Đặt lúc {fmtTime(order.createdAt)} · Trend H1 (tham khảo): {order.h1Trend} · sẽ tự khớp khi giá chạm limit
      </div>
    </div>
  );
}

function OpenTradeCard({ trade, livePrice }: { trade: ScalpPaperTrade; livePrice: number | null }) {
  const isLong = trade.direction === 'LONG';
  const pnlColor = (trade.unrealizedPnlUsd ?? 0) >= 0 ? '#16a34a' : '#dc2626';

  return (
    <div style={{ background: '#fff', border: '1px solid #bfdbfe', borderRadius: 12, padding: 20, marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#2563eb', textTransform: 'uppercase' }}>
            Đang mở — {isLong ? 'LONG' : 'SHORT'} {trade.symbol}
          </span>
        </div>
        <div style={{ fontSize: 13, color: '#6b7280' }}>Giá hiện tại: {livePrice != null ? fmtPrice(livePrice) : '—'}</div>
      </div>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 14 }}>
        <div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Entry</div>
          <div style={{ fontWeight: 600 }}>{fmtPrice(trade.entryPrice)}</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Stop Loss</div>
          <div style={{ fontWeight: 600 }}>{fmtPrice(trade.stopLoss)}</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Take Profit</div>
          <div style={{ fontWeight: 600 }}>{fmtPrice(trade.takeProfit)}</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>R:R kế hoạch</div>
          <div style={{ fontWeight: 600 }}>1:{trade.rrPlanned.toFixed(2)}</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>PnL tạm tính</div>
          <div style={{ fontWeight: 600, color: pnlColor }}>
            {fmtUsd(trade.unrealizedPnlUsd)} ({fmtR(trade.unrealizedR)})
          </div>
        </div>
      </div>

      <div style={{ fontSize: 13, color: '#4b5563', marginTop: 12, lineHeight: 1.5 }}>
        <strong>Lý do vào lệnh:</strong> {trade.reasoning}
      </div>
      {trade.lastNote && (
        <div style={{ fontSize: 13, color: '#1e3a8a', marginTop: 8, lineHeight: 1.5, background: '#eff6ff', padding: '8px 10px', borderRadius: 8 }}>
          <strong>Nhận định mới nhất:</strong> {trade.lastNote}
        </div>
      )}
      <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 8 }}>
        Mở lúc {fmtTime(trade.openedAt)} · Trend H1 (tham khảo): {trade.h1Trend} · Model: {trade.model ?? '—'}
      </div>
      {trade.chartUrl && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>Chart 15m lúc vào lệnh</div>
          <a href={trade.chartUrl} target="_blank" rel="noreferrer">
            <img
              src={trade.chartUrl}
              alt="Chart 15m lúc vào lệnh"
              style={{ width: '100%', maxWidth: 720, border: '1px solid #e5e7eb', borderRadius: 8, display: 'block' }}
            />
          </a>
        </div>
      )}
    </div>
  );
}

function ChartModal({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 10, padding: 12, maxWidth: '95vw', maxHeight: '95vh', overflow: 'auto', position: 'relative' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>Chart 15m lúc vào lệnh</span>
          <button
            onClick={onClose}
            style={{ border: 'none', background: '#f3f4f6', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}
          >
            Đóng ✕
          </button>
        </div>
        <img src={url} alt="Chart 15m lúc vào lệnh" style={{ display: 'block', maxWidth: '90vw', maxHeight: '82vh', width: 'auto', height: 'auto' }} />
      </div>
    </div>
  );
}

export function PaperScalpBoard({ initialBoard }: { initialBoard: BoardData }) {
  const [board, setBoard] = useState<BoardData>(initialBoard);
  const [chartUrl, setChartUrl] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      apiClient.fetchScalpPaperTradeBoard().then(setBoard).catch(() => undefined);
    }, REFRESH_MS);
    return () => clearInterval(interval);
  }, []);

  const { stats } = board;

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Paper Scalp — {board.symbol}</h1>
        <p style={{ color: '#6b7280', margin: '4px 0 0' }}>
          Lệnh giả định — Claude đặt sẵn lệnh limit, mỗi 30 phút kiểm tra: limit tự khớp khi giá chạm mức, sau đó giữ/điều chỉnh SL/TP hoặc cắt sớm. Không vào lệnh market, không phải lệnh thật.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
        <StatTile label="Số lệnh đã đóng" value={String(stats.closedCount)} />
        <StatTile label="Thắng / Thua / Cắt sớm" value={`${stats.wins} / ${stats.losses} / ${stats.closedEarly}`} />
        <StatTile label="Win rate" value={stats.winRate != null ? `${stats.winRate.toFixed(0)}%` : '—'} />
        <StatTile
          label="Tổng PnL"
          value={fmtUsd(stats.totalPnlUsd)}
          color={stats.totalPnlUsd >= 0 ? '#16a34a' : '#dc2626'}
        />
        <StatTile label="Tổng R" value={fmtR(stats.totalR)} color={stats.totalR >= 0 ? '#16a34a' : '#dc2626'} />
      </div>

      {board.pendingOrder && <PendingOrderCard order={board.pendingOrder} livePrice={board.price} />}

      {board.openTrade ? (
        <OpenTradeCard trade={board.openTrade} livePrice={board.price} />
      ) : (
        !board.pendingOrder && (
          <div style={{ color: '#6b7280', fontStyle: 'italic', marginBottom: 24 }}>Chưa có lệnh nào đang mở.</div>
        )
      )}

      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>Lịch sử</h2>
      {board.history.length === 0 ? (
        <div style={{ color: '#6b7280', fontStyle: 'italic' }}>Chưa có lệnh nào đóng.</div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
                {['ID', 'Trạng thái', 'Hướng', 'Entry', 'SL', 'TP', 'Exit', 'PnL', 'R', 'Mở lúc', 'Đóng lúc', 'Chart'].map((h) => (
                  <th key={h} style={{ padding: '8px 12px', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {board.history.map((t) => (
                <tr key={t.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td
                    style={{ padding: '8px 12px', fontFamily: 'monospace', color: '#6b7280', whiteSpace: 'nowrap' }}
                    title={t.id}
                  >
                    {t.id}
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{ color: STATUS_COLOR[t.status], fontWeight: 600 }}>{STATUS_LABEL[t.status]}</span>
                  </td>
                  <td style={{ padding: '8px 12px' }}>{t.direction}</td>
                  <td style={{ padding: '8px 12px' }}>{fmtPrice(t.entryPrice)}</td>
                  <td style={{ padding: '8px 12px' }}>{fmtPrice(t.initialStopLoss)}</td>
                  <td style={{ padding: '8px 12px' }}>{fmtPrice(t.takeProfit)}</td>
                  <td style={{ padding: '8px 12px' }}>{t.exitPrice != null ? fmtPrice(t.exitPrice) : '—'}</td>
                  <td style={{ padding: '8px 12px', color: (t.pnlUsd ?? 0) >= 0 ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
                    {fmtUsd(t.pnlUsd)}
                  </td>
                  <td style={{ padding: '8px 12px' }}>{fmtR(t.rMultiple)}</td>
                  <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{fmtTime(t.openedAt)}</td>
                  <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{fmtTime(t.closedAt)}</td>
                  <td style={{ padding: '8px 12px' }}>
                    {t.chartUrl ? (
                      <button
                        onClick={() => setChartUrl(t.chartUrl)}
                        style={{
                          border: '1px solid #bfdbfe',
                          background: '#eff6ff',
                          color: '#2563eb',
                          borderRadius: 6,
                          padding: '4px 10px',
                          cursor: 'pointer',
                          fontSize: 12,
                          fontWeight: 600,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Xem chart
                      </button>
                    ) : (
                      <span style={{ color: '#9ca3af' }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {chartUrl && <ChartModal url={chartUrl} onClose={() => setChartUrl(null)} />}
    </div>
  );
}
