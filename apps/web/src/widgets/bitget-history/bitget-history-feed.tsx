'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { createApiClient, resolveApiBaseUrl } from '@web/shared/api/client';
import { BitgetJournalDrawer, type JournalTarget } from '@web/widgets/bitget-positions/bitget-journal-drawer';
import type { BitgetClosedTrade, BitgetHistoryResponse } from '@web/shared/api/types';

const REFRESH_MS = 60_000;

const CHART_TIMEFRAMES = [
  { label: 'M30', tf: 'M30' },
  { label: 'H1', tf: '1h' },
  { label: 'H4', tf: '4h' },
  { label: 'D1', tf: '1d' },
] as const;

type ChartTarget = { trade: BitgetClosedTrade; tf: string };

function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(3);
  if (n >= 0.01) return n.toFixed(5);
  return n.toPrecision(3);
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtUsdPlain(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`;
}

function fmtQty(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function pnlClass(n: number): string {
  if (n > 0) return 'bg-pnl--up';
  if (n < 0) return 'bg-pnl--down';
  return '';
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function relTime(iso: string): string {
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 5) return 'vừa xong';
  if (secs < 60) return `${secs}s trước`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} phút trước`;
  return new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

type Props = {
  initial: BitgetHistoryResponse;
  /** When rendered inside the merged Bitget tabs, drop the outer page chrome + title. */
  embedded?: boolean;
};

export function BitgetHistoryFeed({ initial, embedded = false }: Props) {
  const [data, setData] = useState<BitgetHistoryResponse>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [journalTarget, setJournalTarget] = useState<JournalTarget | null>(null);
  const [chartTarget, setChartTarget] = useState<ChartTarget | null>(null);
  const clientRef = useRef(createApiClient());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await clientRef.current.fetchBitgetHistory({ limit: 200 });
      setData(next);
      setError(null);
    } catch {
      setError('Không tải được lịch sử từ máy chủ. Thử lại sau.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const { configured, trades, summary, fetchedAt } = data;

  // Sort closed trades by close time descending — most recently closed first.
  const sortedTrades = [...trades].sort(
    (a, b) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime(),
  );

  return (
    <div className={embedded ? 'bg-panel' : 'page'}>
      <div className="bg-head">
        <div>
          {!embedded && <h1>Bitget · Lịch sử lệnh &amp; PnL</h1>}
          <p className="bg-sub">
            Vị thế đã đóng (USDT futures) · đồng bộ {relTime(fetchedAt)}
            {loading ? ' · đang tải…' : ''}
          </p>
        </div>
        <button className="bg-refresh" onClick={refresh} disabled={loading}>
          ↻ Làm mới
        </button>
      </div>

      {error && <div className="bg-alert bg-alert--error">{error}</div>}

      {!configured && trades.length === 0 ? (
        <div className="bg-alert">
          Chưa cấu hình Bitget API. Thêm <code>BITGET_API_KEY</code>, <code>BITGET_API_SECRET</code>,{' '}
          <code>BITGET_API_PASSPHRASE</code> vào <code>.env</code> để worker đồng bộ lịch sử lệnh.
        </div>
      ) : (
        <>
          <div className="bg-tiles">
            <div className="bg-tile">
              <span className="bg-tile-label">Tổng PnL ròng</span>
              <span className={`bg-tile-value ${pnlClass(summary.totalNetProfit)}`}>
                {fmtUsd(summary.totalNetProfit)}
              </span>
            </div>
            <div className="bg-tile">
              <span className="bg-tile-label">Win rate</span>
              <span className="bg-tile-value">
                {summary.winRatePct.toFixed(1)}%
                <span className="bg-tile-sub">
                  {summary.wins}W · {summary.losses}L
                </span>
              </span>
            </div>
            <div className="bg-tile">
              <span className="bg-tile-label">Số lệnh</span>
              <span className="bg-tile-value">{summary.trades}</span>
            </div>
            <div className="bg-tile">
              <span className="bg-tile-label">TB / lệnh</span>
              <span className={`bg-tile-value ${pnlClass(summary.avgNetProfit)}`}>
                {fmtUsd(summary.avgNetProfit)}
              </span>
            </div>
            <div className="bg-tile">
              <span className="bg-tile-label">Lãi lớn nhất</span>
              <span className="bg-tile-value bg-pnl--up">{fmtUsd(summary.bestNetProfit)}</span>
            </div>
            <div className="bg-tile">
              <span className="bg-tile-label">Lỗ lớn nhất</span>
              <span className="bg-tile-value bg-pnl--down">{fmtUsd(summary.worstNetProfit)}</span>
            </div>
          </div>

          {trades.length === 0 ? (
            <div className="bg-alert">
              Chưa có lệnh nào được đồng bộ. Worker sẽ tự kéo lịch sử ~90 ngày trong vài phút tới.
            </div>
          ) : (
            <div className="bg-table-wrap">
              <table className="bg-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th className="bg-num">Size</th>
                    <th className="bg-num">Giá vào</th>
                    <th className="bg-num">Giá đóng</th>
                    <th className="bg-num">Phí</th>
                    <th className="bg-num">Funding</th>
                    <th className="bg-num">PnL ròng</th>
                    <th className="bg-num">Mở</th>
                    <th className="bg-num">Đóng</th>
                    <th className="bg-num">Chart</th>
                    <th className="bg-num">Nhật ký</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTrades.map((t) => (
                    <TradeRow
                      key={t.positionId || t.tradeKey}
                      t={t}
                      onChart={(tf) => setChartTarget({ trade: t, tf })}
                      onJournal={() =>
                        setJournalTarget({
                          tradeKey: t.tradeKey,
                          symbol: t.symbol,
                          holdSide: t.holdSide,
                          status: 'closed',
                          entryPrice: t.openAvgPrice,
                          markPrice: t.closeAvgPrice,
                          netProfit: t.netProfit,
                          openedAt: t.openedAt,
                          closedAt: t.closedAt,
                        })
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {journalTarget && (
        <BitgetJournalDrawer
          key={journalTarget.tradeKey}
          target={journalTarget}
          onClose={() => setJournalTarget(null)}
        />
      )}

      {chartTarget && (
        <TradeChartDialog
          target={chartTarget}
          onChangeTf={(tf) => setChartTarget((prev) => (prev ? { ...prev, tf } : prev))}
          onClose={() => setChartTarget(null)}
        />
      )}
    </div>
  );
}

function TradeRow({
  t,
  onChart,
  onJournal,
}: {
  t: BitgetClosedTrade;
  onChart: (tf: string) => void;
  onJournal: () => void;
}) {
  const isLong = t.holdSide === 'long';
  return (
    <tr>
      <td className="bg-symbol">
        <span className="bg-symbol-side">
          {t.symbol}
          <span className={`bg-side ${isLong ? 'bg-side--long' : 'bg-side--short'}`}>
            {isLong ? 'LONG' : 'SHORT'}
          </span>
        </span>
      </td>
      <td className="bg-num">{fmtQty(t.size)}</td>
      <td className="bg-num">{fmtPrice(t.openAvgPrice)}</td>
      <td className="bg-num">{fmtPrice(t.closeAvgPrice)}</td>
      <td className="bg-num">{fmtUsdPlain(t.feesUsd)}</td>
      <td className="bg-num">{fmtUsdPlain(t.totalFunding)}</td>
      <td className={`bg-num bg-pnl-cell ${pnlClass(t.netProfit)}`}>
        <span className="bg-pnl-usd">{fmtUsd(t.netProfit)}</span>
        <span className="bg-pnl-pct">{fmtPct(t.netProfitPct)}</span>
      </td>
      <td className="bg-num bg-time">{fmtDateTime(t.openedAt)}</td>
      <td className="bg-num bg-time">{fmtDateTime(t.closedAt)}</td>
      <td className="bg-num">
        <div className="bg-tf-btns">
          {CHART_TIMEFRAMES.map(({ label, tf }) => (
            <button
              key={tf}
              type="button"
              className="bg-tf-btn"
              onClick={() => onChart(tf)}
              title={`Xem chart ${label} quanh lúc vào/đóng lệnh`}
            >
              {label}
            </button>
          ))}
        </div>
      </td>
      <td className="bg-num">
        <button type="button" className="bg-journal-btn" onClick={onJournal} title="Nhật ký lệnh">
          📝
        </button>
      </td>
    </tr>
  );
}

/** Trade-label for the chart URL: timeframe pretty name. */
function tfLabel(tf: string): string {
  return CHART_TIMEFRAMES.find((c) => c.tf === tf)?.label ?? tf;
}

/** Build the review-chart PNG URL from the trade + timeframe. */
function tradeChartUrl(t: BitgetClosedTrade, tf: string): string {
  const params = new URLSearchParams({
    tradeKey: t.tradeKey,
    symbol: t.symbol,
    timeframe: tf,
    holdSide: t.holdSide,
    entryPrice: String(t.openAvgPrice),
    closePrice: String(t.closeAvgPrice),
    pnlUsd: String(t.netProfit),
    openedAt: String(new Date(t.openedAt).getTime()),
    closedAt: String(new Date(t.closedAt).getTime()),
  });
  return `${resolveApiBaseUrl()}/bitget/trade-chart?${params.toString()}`;
}

/**
 * Fullscreen review chart for a closed trade (windowed on its open/close window,
 * with entry/close markers). A "Lưu" button uploads the PNG to R2 and stores the
 * DB link so the trade can be referenced as study data later.
 */
function TradeChartDialog({
  target,
  onChangeTf,
  onClose,
}: {
  target: ChartTarget;
  onChangeTf: (tf: string) => void;
  onClose: () => void;
}) {
  const { trade, tf } = target;
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const clientRef = useRef(createApiClient());

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setImgSrc(null);
    setFailed(false);
    setSavedUrl(null);
    setSaveErr(null);
    const url = `${tradeChartUrl(trade, tf)}&_t=${Date.now()}`;
    fetch(url, { credentials: 'include', cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setImgSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [trade, tf]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function save() {
    setSaving(true);
    setSaveErr(null);
    try {
      const rec = await clientRef.current.saveBitgetTradeChart({
        tradeKey: trade.tradeKey,
        symbol: trade.symbol,
        timeframe: tf,
        holdSide: trade.holdSide,
        entryPrice: trade.openAvgPrice,
        closePrice: trade.closeAvgPrice,
        pnlUsd: trade.netProfit,
        openedAt: new Date(trade.openedAt).getTime(),
        closedAt: new Date(trade.closedAt).getTime(),
      });
      setSavedUrl(rec.url);
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : 'Lưu chart thất bại.');
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog dialog--fullscreen eb-chart-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">
            {trade.symbol} <span className="eb-tf">{tfLabel(tf)}</span>
            <span className="eb-chart-note"> · review lệnh đã đóng</span>
          </span>
          <div className="bg-tf-btns bg-tf-btns--dialog">
            {CHART_TIMEFRAMES.map(({ label, tf: t }) => (
              <button
                key={t}
                type="button"
                className={`bg-tf-btn ${t === tf ? 'bg-tf-btn--active' : ''}`}
                onClick={() => onChangeTf(t)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="bg-open-btn bg-chart-save-btn"
            onClick={save}
            disabled={saving || !imgSrc}
            title="Upload chart lên R2 và lưu link vào DB để tham chiếu sau"
          >
            {saving ? 'Đang lưu…' : savedUrl ? '✓ Đã lưu' : '💾 Lưu'}
          </button>
          <button className="dialog-close" onClick={onClose} aria-label="Đóng">
            ✕
          </button>
        </div>
        {saveErr && <div className="bg-alert bg-alert--error">{saveErr}</div>}
        {savedUrl && (
          <div className="bg-alert bg-alert--ok">
            Đã lưu chart ·{' '}
            <a href={savedUrl} target="_blank" rel="noreferrer">
              mở link R2
            </a>
          </div>
        )}
        <div className="dialog-body eb-chart-body">
          {failed ? (
            <div className="eb-chart-status">Không tải được chart. Thử lại sau.</div>
          ) : imgSrc ? (
            <img className="eb-chart-img" src={imgSrc} alt={`${trade.symbol} ${tfLabel(tf)} chart`} />
          ) : (
            <div className="eb-chart-status">Đang tải chart…</div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
