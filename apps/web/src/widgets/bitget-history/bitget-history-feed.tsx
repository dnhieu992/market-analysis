'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { createApiClient, resolveApiBaseUrl } from '@web/shared/api/client';
import { BitgetJournalDrawer, type JournalTarget } from '@web/widgets/bitget-positions/bitget-journal-drawer';
import type { BitgetClosedTrade, BitgetHistoryResponse, BitgetTradeChart } from '@web/shared/api/types';

import { SymbolMultiSelect } from '@web/widgets/bitget/symbol-multi-select';
import { ChartNoteDialog, ChartNoteView } from '@web/widgets/bitget/chart-note-dialog';

// Refresh cadence — paired with the worker's ~15s reconcile cron so a just-closed
// trade surfaces here within ~30s worst-case (15s worker sync + 15s UI poll).
const REFRESH_MS = 15_000;

const CHART_TIMEFRAMES = [
  { label: 'M30', tf: 'M30' },
  { label: 'H1', tf: '1h' },
  { label: 'H4', tf: '4h' },
  { label: 'D1', tf: '1d' },
] as const;

// Timeframe the "Xem chart" button opens on; users switch inside the dialog.
const DEFAULT_CHART_TF = '4h';

// History table pagination: default rows per page + the selectable page sizes.
const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

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
  const [refTrade, setRefTrade] = useState<BitgetClosedTrade | null>(null);
  // Coin-name filter (empty = all coins) + pagination state.
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);
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

  // Distinct coin names present in history, for the filter select-box.
  const availableSymbols = useMemo(
    () => Array.from(new Set(trades.map((t) => t.symbol))).sort(),
    [trades],
  );

  // Sort by close time descending (most recent first), then apply the coin filter.
  const filteredTrades = useMemo(() => {
    const sorted = [...trades].sort(
      (a, b) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime(),
    );
    if (selectedSymbols.length === 0) return sorted;
    const set = new Set(selectedSymbols);
    return sorted.filter((t) => set.has(t.symbol));
  }, [trades, selectedSymbols]);

  // Reset to page 1 whenever the filter or page size changes.
  useEffect(() => {
    setPage(1);
  }, [selectedSymbols, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredTrades.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageTrades = filteredTrades.slice(pageStart, pageStart + pageSize);
  const rangeFrom = filteredTrades.length === 0 ? 0 : pageStart + 1;
  const rangeTo = Math.min(pageStart + pageSize, filteredTrades.length);

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
            <>
            <div className="bg-table-toolbar">
              <div className="bg-toolbar-filter">
                <span className="bg-toolbar-label">Lọc coin:</span>
                <SymbolMultiSelect
                  symbols={availableSymbols}
                  selected={selectedSymbols}
                  onChange={setSelectedSymbols}
                />
                {selectedSymbols.length > 0 && (
                  <button
                    type="button"
                    className="bg-toolbar-clear"
                    onClick={() => setSelectedSymbols([])}
                    title="Xoá bộ lọc"
                  >
                    ✕ Xoá lọc
                  </button>
                )}
              </div>
              <span className="bg-toolbar-count">
                {filteredTrades.length} lệnh
                {selectedSymbols.length > 0 ? ` (đã lọc từ ${trades.length})` : ''}
              </span>
            </div>
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
                    <th className="bg-num" title="Xem lại các chart đã lưu từ đúng lệnh này">
                      Tham chiếu
                    </th>
                    <th className="bg-num">Nhật ký</th>
                  </tr>
                </thead>
                <tbody>
                  {pageTrades.map((t) => (
                    <TradeRow
                      key={t.positionId || t.tradeKey}
                      t={t}
                      onChart={() => setChartTarget({ trade: t, tf: DEFAULT_CHART_TF })}
                      onReference={() => setRefTrade(t)}
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

            {filteredTrades.length === 0 ? (
              <div className="bg-alert">Không có lệnh nào khớp bộ lọc.</div>
            ) : (
              <div className="bg-pagination">
                <div className="bg-page-size">
                  <span>Hiển thị</span>
                  <select
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                    aria-label="Số dòng mỗi trang"
                  >
                    {PAGE_SIZE_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  <span>/ trang</span>
                </div>
                <div className="bg-page-nav">
                  <span className="bg-page-range">
                    {rangeFrom}–{rangeTo} / {filteredTrades.length}
                  </span>
                  <button
                    type="button"
                    className="bg-page-btn"
                    disabled={currentPage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    ‹ Trước
                  </button>
                  <span className="bg-page-info">
                    Trang {currentPage}/{totalPages}
                  </span>
                  <button
                    type="button"
                    className="bg-page-btn"
                    disabled={currentPage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Sau ›
                  </button>
                </div>
              </div>
            )}
            </>
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

      {refTrade && (
        <TradeChartGalleryDialog trade={refTrade} onClose={() => setRefTrade(null)} />
      )}
    </div>
  );
}

function TradeRow({
  t,
  onChart,
  onReference,
  onJournal,
}: {
  t: BitgetClosedTrade;
  onChart: () => void;
  onReference: () => void;
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
        <button
          type="button"
          className="bg-tf-btn bg-view-chart-btn"
          onClick={onChart}
          title="Xem chart quanh lúc vào/đóng lệnh"
        >
          📈 Xem chart
        </button>
      </td>
      <td className="bg-num">
        <button
          type="button"
          className="bg-ref-btn"
          onClick={onReference}
          title="Xem lại các chart đã lưu từ đúng lệnh này"
        >
          🖼 Reference
        </button>
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
  const [notePrompt, setNotePrompt] = useState(false);
  const clientRef = useRef(createApiClient());

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setImgSrc(null);
    setFailed(false);
    setSavedUrl(null);
    setSaveErr(null);
    setNotePrompt(false);
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

  async function save(note: string) {
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
        note,
      });
      setSavedUrl(rec.url);
      setNotePrompt(false);
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
            onClick={() => {
              setSaveErr(null);
              setNotePrompt(true);
            }}
            disabled={saving || !imgSrc}
            title="Thêm ghi chú rồi lưu chart lên R2 để tham chiếu sau"
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
      {notePrompt && (
        <ChartNoteDialog
          saving={saving}
          error={saveErr}
          onSubmit={(note) => void save(note)}
          onCancel={() => setNotePrompt(false)}
        />
      )}
    </div>,
    document.body,
  );
}

/** Saved-at timestamp formatted for the gallery caption. */
function fmtSavedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Reference gallery for the charts saved from ONE specific closed trade. Unlike
 * the Setup-tab gallery (which shows every chart ever saved for a coin), this is
 * scoped by `tradeKey` so it only surfaces the images saved from this exact
 * position. Same product-viewer layout: a thumbnail rail on the left, big main
 * image on the right. The PNGs live on public R2 and load straight from `url`.
 */
function TradeChartGalleryDialog({ trade, onClose }: { trade: BitgetClosedTrade; onClose: () => void }) {
  const clientRef = useRef(createApiClient());
  const [charts, setCharts] = useState<BitgetTradeChart[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setCharts(null);
    setFailed(false);
    clientRef.current
      .fetchBitgetSavedTradeCharts(trade.tradeKey)
      .then((list) => {
        if (!alive) return;
        setCharts(list);
        setActiveId(list[0]?.id ?? null);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [trade.tradeKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const active = charts?.find((c) => c.id === activeId) ?? charts?.[0] ?? null;
  const count = charts?.length ?? 0;
  const isLong = trade.holdSide === 'long';

  return createPortal(
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog dialog--fullscreen eb-chart-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">
            {trade.symbol}{' '}
            <span className={`bg-side ${isLong ? 'bg-side--long' : 'bg-side--short'}`}>
              {isLong ? 'LONG' : 'SHORT'}
            </span>
            <span className="eb-chart-note"> · chart đã lưu từ lệnh này</span>
            {count > 0 && <span className="bg-gallery-count">{count} ảnh</span>}
          </span>
          <button className="dialog-close" onClick={onClose} aria-label="Đóng">
            ✕
          </button>
        </div>
        <div className="dialog-body bg-gallery-body">
          {failed ? (
            <div className="eb-chart-status">Không tải được danh sách chart. Thử lại sau.</div>
          ) : charts == null ? (
            <div className="eb-chart-status">Đang tải…</div>
          ) : charts.length === 0 ? (
            <div className="eb-chart-status">
              Chưa có chart nào được lưu từ lệnh này. Bấm “📈 Xem chart”, chọn khung rồi bấm
              “💾 Lưu” để lưu tham chiếu cho đúng lệnh này.
            </div>
          ) : (
            <div className="bg-gallery">
              <div className="bg-gallery-rail" role="tablist" aria-label="Danh sách chart">
                {charts.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="tab"
                    aria-selected={c.id === active?.id}
                    className={`bg-gallery-thumb ${c.id === active?.id ? 'bg-gallery-thumb--active' : ''}`}
                    onClick={() => setActiveId(c.id)}
                    title={`${tfLabel(c.timeframe)} · ${fmtSavedAt(c.createdAt)}`}
                  >
                    <img src={c.url} alt={`${trade.symbol} ${tfLabel(c.timeframe)}`} loading="lazy" />
                    <span className="bg-gallery-thumb-tf">{tfLabel(c.timeframe)}</span>
                    {c.note && (
                      <span className="bg-gallery-thumb-note" title="Có ghi chú">
                        📝
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <div className="bg-gallery-main">
                {active && (
                  <>
                    <a
                      className="bg-gallery-main-img"
                      href={active.url}
                      target="_blank"
                      rel="noreferrer"
                      title="Mở ảnh gốc trong tab mới"
                    >
                      <img src={active.url} alt={`${trade.symbol} ${tfLabel(active.timeframe)} chart`} />
                    </a>
                    <div className="bg-gallery-caption">
                      <span className="bg-gallery-caption-tf">{tfLabel(active.timeframe)}</span>
                      <span className="bg-gallery-caption-date">Lưu lúc {fmtSavedAt(active.createdAt)}</span>
                    </div>
                    <ChartNoteView note={active.note} />
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
