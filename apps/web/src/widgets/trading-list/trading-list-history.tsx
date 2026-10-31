'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { createApiClient, resolveApiBaseUrl } from '@web/shared/api/client';
import type {
  BitgetClosedSummary,
  BitgetClosedTrade,
  BitgetHistoryResponse,
  BitgetTradeChart,
  MexcHistoryResponse,
  TradingExchange,
} from '@web/shared/api/types';
import { SymbolSearchFilter } from '@web/shared/ui/symbol-search-filter/symbol-search-filter';

import { ChartIcon } from '../bitget/chart-icon';
import { ChartNoteDialog, ChartNoteView } from '../bitget/chart-note-dialog';
import { matchesSymbolSelection } from '../bitget/symbol-filter-input';
import { BitgetJournalDrawer, type JournalTarget } from '../bitget-positions/bitget-journal-drawer';
import { MexcJournalDrawer } from '../mexc-positions/mexc-journal-drawer';
import { ExchangeFilterBar } from './exchange-filter';
import { EXCHANGE_LABEL, EXCHANGE_SHORT, exchangesOf, type ExchangeFilter } from './exchanges';

import styles from './trading-list.module.css';

// Same cadence as the /bitget and /mexc history tabs (paired with the worker's ~15s reconcile).
const REFRESH_MS = 15_000;
// The MEXC endpoint caps one page at 500 closed trades.
const MEXC_HISTORY_LIMIT = 500;

const CHART_TIMEFRAMES = [
  { label: 'M30', tf: 'M30' },
  { label: 'H1', tf: '1h' },
  { label: 'H4', tf: '4h' },
  { label: 'D1', tf: '1d' },
] as const;

const DEFAULT_CHART_TF = '4h';

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

// Bitget and MEXC closed trades / summaries / saved charts share one shape; the Bitget type stands for both.
type ClosedTrade = BitgetClosedTrade;
type Summary = BitgetClosedSummary;
type TradeChart = BitgetTradeChart;
type Row = { ex: TradingExchange; t: ClosedTrade };
type ChartTarget = { row: Row; tf: string };
type JournalOpen = { ex: TradingExchange; target: JournalTarget };

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

/** Same aggregates as the server summary, over an arbitrary list of trades. */
function summarize(trades: ClosedTrade[]): Omit<Summary, 'totalVolumeUsd'> {
  let wins = 0;
  let losses = 0;
  let totalNetProfit = 0;
  let bestNetProfit = 0;
  let worstNetProfit = 0;
  for (const t of trades) {
    totalNetProfit += t.netProfit;
    if (t.netProfit > 0) wins++;
    else if (t.netProfit < 0) losses++;
    if (t.netProfit > bestNetProfit) bestNetProfit = t.netProfit;
    if (t.netProfit < worstNetProfit) worstNetProfit = t.netProfit;
  }
  const decided = wins + losses;
  return {
    trades: trades.length,
    wins,
    losses,
    winRatePct: decided > 0 ? (wins / decided) * 100 : 0,
    totalNetProfit,
    avgNetProfit: trades.length > 0 ? totalNetProfit / trades.length : 0,
    bestNetProfit,
    worstNetProfit,
  };
}

/** Server summaries of several exchanges folded into one (covers trades beyond the loaded page). */
function combineSummaries(list: Summary[]): Omit<Summary, 'totalVolumeUsd'> {
  const trades = list.reduce((s, x) => s + x.trades, 0);
  const wins = list.reduce((s, x) => s + x.wins, 0);
  const losses = list.reduce((s, x) => s + x.losses, 0);
  const totalNetProfit = list.reduce((s, x) => s + x.totalNetProfit, 0);
  const decided = wins + losses;
  return {
    trades,
    wins,
    losses,
    winRatePct: list.length === 1 ? list[0]!.winRatePct : decided > 0 ? (wins / decided) * 100 : 0,
    totalNetProfit,
    avgNetProfit: trades > 0 ? totalNetProfit / trades : 0,
    bestNetProfit: Math.max(0, ...list.map((x) => x.bestNetProfit)),
    worstNetProfit: Math.min(0, ...list.map((x) => x.worstNetProfit)),
  };
}

function ExTag({ ex }: { ex: TradingExchange }) {
  return (
    <span className={`${styles.exTag} ${styles[`ex_${ex}`]}`} title={EXCHANGE_LABEL[ex]}>
      {EXCHANGE_SHORT[ex]}
    </span>
  );
}

type Props = {
  bitgetHistory: BitgetHistoryResponse;
  mexcHistory: MexcHistoryResponse;
  filter: ExchangeFilter;
  onFilterChange: (next: ExchangeFilter) => void;
  /** Reports how many closed trades the current filter shows, for the tab label. */
  onCount?: (count: number) => void;
};

/**
 * "Lịch sử" tab of /trading-list: closed trades of Bitget and MEXC in one table
 * (newest close first), tagged BG / MX, with the same coin filter, paging,
 * review chart, saved-chart gallery and journal as the /bitget and /mexc tabs.
 */
export function TradingListHistory({ bitgetHistory, mexcHistory, filter, onFilterChange, onCount }: Props) {
  const [data, setData] = useState<Record<TradingExchange, BitgetHistoryResponse>>({
    bitget: bitgetHistory,
    mexc: mexcHistory,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [journal, setJournal] = useState<JournalOpen | null>(null);
  const [chartTarget, setChartTarget] = useState<ChartTarget | null>(null);
  const [refRow, setRefRow] = useState<Row | null>(null);
  const [selectedSymbols, setSelectedSymbols] = useState<Set<string>>(new Set());
  const toggleSymbol = useCallback((symbol: string) => {
    setSelectedSymbols((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  }, []);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);
  // Saved-chart count per exchange + tradeKey — the Attachments badge.
  const [chartCounts, setChartCounts] = useState<Record<TradingExchange, Record<string, number>>>({ bitget: {}, mexc: {} });
  const clientRef = useRef(createApiClient());

  const refreshChartCounts = useCallback(async () => {
    const [bg, mx] = await Promise.allSettled([
      clientRef.current.fetchBitgetChartCountsByTrade(),
      clientRef.current.fetchMexcChartCountsByTrade(),
    ]);
    const toMap = (rows: Array<{ tradeKey: string; count: number }>) => Object.fromEntries(rows.map((r) => [r.tradeKey, r.count]));
    setChartCounts((prev) => ({
      bitget: bg.status === 'fulfilled' ? toMap(bg.value) : prev.bitget,
      mexc: mx.status === 'fulfilled' ? toMap(mx.value) : prev.mexc,
    }));
  }, []);

  useEffect(() => {
    void refreshChartCounts();
  }, [refreshChartCounts]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [bg, mx] = await Promise.allSettled([
      clientRef.current.fetchBitgetHistory({ limit: 'all' }),
      clientRef.current.fetchMexcHistory({ limit: MEXC_HISTORY_LIMIT }),
    ]);
    setData((prev) => ({
      bitget: bg.status === 'fulfilled' ? bg.value : prev.bitget,
      mexc: mx.status === 'fulfilled' ? mx.value : prev.mexc,
    }));
    const failed = [bg.status === 'rejected' ? 'Bitget' : null, mx.status === 'rejected' ? 'MEXC' : null].filter(Boolean);
    setError(failed.length > 0 ? `Không tải được lịch sử ${failed.join(' và ')} từ máy chủ. Thử lại sau.` : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    const id = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const shownExchanges = useMemo(() => exchangesOf(filter), [filter]);
  const missingExchanges = shownExchanges.filter((ex) => !data[ex].configured && data[ex].trades.length === 0);

  // Every kept exchange's trades, newest close first.
  const rows = useMemo<Row[]>(
    () =>
      shownExchanges
        .flatMap((ex) => data[ex].trades.map((t) => ({ ex, t })))
        .sort((a, b) => new Date(b.t.closedAt).getTime() - new Date(a.t.closedAt).getTime()),
    [shownExchanges, data],
  );

  useEffect(() => {
    onCount?.(rows.length);
  }, [rows.length, onCount]);

  const availableSymbols = useMemo(() => Array.from(new Set(rows.map((r) => r.t.symbol))).sort(), [rows]);

  const filteredRows = useMemo(() => {
    if (selectedSymbols.size === 0) return rows;
    return rows.filter((r) => matchesSymbolSelection(r.t.symbol, selectedSymbols));
  }, [rows, selectedSymbols]);

  // Tiles follow both filters: the server summaries when no coin is picked, else recomputed over the matched rows.
  const displaySummary = useMemo(() => {
    if (selectedSymbols.size === 0) return combineSummaries(shownExchanges.map((ex) => data[ex].summary));
    return summarize(filteredRows.map((r) => r.t));
  }, [selectedSymbols, filteredRows, shownExchanges, data]);

  // Back to page 1 whenever a filter or the page size changes.
  useEffect(() => {
    setPage(1);
  }, [selectedSymbols, pageSize, filter]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageRows = filteredRows.slice(pageStart, pageStart + pageSize);
  const rangeFrom = filteredRows.length === 0 ? 0 : pageStart + 1;
  const rangeTo = Math.min(pageStart + pageSize, filteredRows.length);

  // "đồng bộ …" reports the older of the kept exchanges' snapshots.
  const fetchedAt = shownExchanges
    .map((ex) => data[ex].fetchedAt)
    .reduce((oldest, iso) => (new Date(iso).getTime() < new Date(oldest).getTime() ? iso : oldest));

  const JournalDrawer = journal?.ex === 'mexc' ? MexcJournalDrawer : BitgetJournalDrawer;

  return (
    <div className="bg-panel">
      <div className="bg-head">
        <div>
          <ExchangeFilterBar value={filter} onChange={onFilterChange} />
          <p className="bg-sub">
            Vị thế đã đóng (USDT futures) · đồng bộ {relTime(fetchedAt)}
            {loading ? ' · đang tải…' : ''}
          </p>
        </div>
        <button className="bg-refresh" onClick={() => void refresh()} disabled={loading}>
          ↻ Làm mới
        </button>
      </div>

      {error && <div className="bg-alert bg-alert--error">{error}</div>}

      {missingExchanges.length > 0 && (
        <div className={styles.alertList}>
          {missingExchanges.map((ex) => (
            <div key={ex} className="bg-alert">
              <ExTag ex={ex} /> Chưa cấu hình {EXCHANGE_LABEL[ex]} API — worker chưa đồng bộ lịch sử lệnh của sàn này.
            </div>
          ))}
        </div>
      )}

      {missingExchanges.length < shownExchanges.length && (
        <>
          <div className="bg-tiles">
            <div className="bg-tile">
              <span className="bg-tile-label">Tổng PnL ròng{selectedSymbols.size > 0 ? ' (đã lọc)' : ''}</span>
              <span className={`bg-tile-value ${pnlClass(displaySummary.totalNetProfit)}`}>{fmtUsd(displaySummary.totalNetProfit)}</span>
            </div>
            <div className="bg-tile">
              <span className="bg-tile-label">Win rate</span>
              <span className="bg-tile-value">
                {displaySummary.winRatePct.toFixed(1)}%
                <span className="bg-tile-sub">
                  {displaySummary.wins}W · {displaySummary.losses}L
                </span>
              </span>
            </div>
            <div className="bg-tile">
              <span className="bg-tile-label">Số lệnh</span>
              <span className="bg-tile-value">{displaySummary.trades}</span>
            </div>
            <div className="bg-tile">
              <span className="bg-tile-label">TB / lệnh</span>
              <span className={`bg-tile-value ${pnlClass(displaySummary.avgNetProfit)}`}>{fmtUsd(displaySummary.avgNetProfit)}</span>
            </div>
            <div className="bg-tile">
              <span className="bg-tile-label">Lãi lớn nhất</span>
              <span className="bg-tile-value bg-pnl--up">{fmtUsd(displaySummary.bestNetProfit)}</span>
            </div>
            <div className="bg-tile">
              <span className="bg-tile-label">Lỗ lớn nhất</span>
              <span className="bg-tile-value bg-pnl--down">{fmtUsd(displaySummary.worstNetProfit)}</span>
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="bg-alert">Chưa có lệnh nào được đồng bộ. Worker sẽ tự kéo lịch sử ~90 ngày trong vài phút tới.</div>
          ) : (
            <>
              <div className="bg-table-toolbar">
                <div className="bg-toolbar-filter pf-coin-filter">
                  <span className="bg-toolbar-label">Lọc coin:</span>
                  <SymbolSearchFilter
                    symbols={availableSymbols}
                    selected={selectedSymbols}
                    onToggle={toggleSymbol}
                    count={filteredRows.length}
                  />
                  {selectedSymbols.size > 0 && (
                    <button type="button" className="bg-toolbar-clear" onClick={() => setSelectedSymbols(new Set())} title="Xoá bộ lọc">
                      ✕ Xoá lọc
                    </button>
                  )}
                </div>
              </div>
              <div className="bg-table-wrap">
                <table className="bg-table">
                  <thead>
                    <tr>
                      <th className={styles.exCol}>Sàn</th>
                      <th>Symbol</th>
                      <th className="bg-num">Size</th>
                      <th className="bg-num">Giá vào</th>
                      <th className="bg-num">Giá đóng</th>
                      <th className="bg-num">Phí</th>
                      <th className="bg-num">Funding</th>
                      <th className="bg-num">PnL ròng</th>
                      <th className="bg-num">Mở</th>
                      <th className="bg-num">Đóng</th>
                      <th className="bg-num" title="Số ảnh chart đã lưu từ đúng lệnh này — bấm để xem">
                        Attachments
                      </th>
                      <th className="bg-num">Nhật ký</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((row) => {
                      const { ex, t } = row;
                      return (
                        <TradeRow
                          key={`${ex}-${t.positionId || t.tradeKey}`}
                          ex={ex}
                          t={t}
                          attachments={chartCounts[ex][t.tradeKey] ?? 0}
                          onChart={() => setChartTarget({ row, tf: DEFAULT_CHART_TF })}
                          onReference={() => setRefRow(row)}
                          onJournal={() =>
                            setJournal({
                              ex,
                              target: {
                                tradeKey: t.tradeKey,
                                symbol: t.symbol,
                                holdSide: t.holdSide,
                                status: 'closed',
                                entryPrice: t.openAvgPrice,
                                markPrice: t.closeAvgPrice,
                                netProfit: t.netProfit,
                                openedAt: t.openedAt,
                                closedAt: t.closedAt,
                              },
                            })
                          }
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {filteredRows.length === 0 ? (
                <div className="bg-alert">Không có lệnh nào khớp bộ lọc.</div>
              ) : (
                <div className="bg-pagination">
                  <div className="bg-page-size">
                    <span>Hiển thị</span>
                    <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} aria-label="Số dòng mỗi trang">
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
                      {rangeFrom}–{rangeTo} / {filteredRows.length}
                    </span>
                    <button type="button" className="bg-page-btn" disabled={currentPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
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

      {journal && (
        <JournalDrawer key={`${journal.ex}-${journal.target.tradeKey}`} target={journal.target} onClose={() => setJournal(null)} />
      )}

      {chartTarget && (
        <TradeChartDialog
          target={chartTarget}
          onChangeTf={(tf) => setChartTarget((prev) => (prev ? { ...prev, tf } : prev))}
          // A chart may have been saved from here — refresh the Attachments counts.
          onClose={() => {
            setChartTarget(null);
            void refreshChartCounts();
          }}
        />
      )}

      {refRow && <TradeChartGalleryDialog row={refRow} onClose={() => setRefRow(null)} />}
    </div>
  );
}

function TradeRow({
  ex,
  t,
  attachments,
  onChart,
  onReference,
  onJournal,
}: {
  ex: TradingExchange;
  t: ClosedTrade;
  attachments: number;
  onChart: () => void;
  onReference: () => void;
  onJournal: () => void;
}) {
  const isLong = t.holdSide === 'long';
  return (
    <tr>
      <td className={styles.exCol}>
        <ExTag ex={ex} />
      </td>
      <td className="bg-symbol">
        <span className="bg-symbol-side">
          {t.symbol}
          <span className={`bg-side ${isLong ? 'bg-side--long' : 'bg-side--short'}`}>{isLong ? 'LONG' : 'SHORT'}</span>
          <button
            type="button"
            className="bg-chart-icon-btn"
            onClick={onChart}
            title="Xem chart quanh lúc vào/đóng lệnh"
            aria-label={`Xem chart ${t.symbol}`}
          >
            <ChartIcon />
          </button>
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
          className={`bg-ref-btn bg-attach-btn ${attachments === 0 ? 'bg-attach-btn--empty' : ''}`}
          onClick={onReference}
          title={attachments === 0 ? 'Chưa có ảnh chart nào lưu từ lệnh này' : `${attachments} ảnh chart đã lưu từ lệnh này — bấm để xem`}
        >
          <span className="bg-attach-icon" aria-hidden>
            🖼
          </span>
          <span className="bg-attach-count">{attachments}</span>
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

function tfLabel(tf: string): string {
  return CHART_TIMEFRAMES.find((c) => c.tf === tf)?.label ?? tf;
}

/** Review-chart PNG URL on the trade's own exchange (`/bitget/trade-chart` or `/mexc/trade-chart`). */
function tradeChartUrl({ ex, t }: Row, tf: string): string {
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
  return `${resolveApiBaseUrl()}/${ex}/trade-chart?${params.toString()}`;
}

/** Fullscreen review chart of a closed trade, with "Lưu" to R2 — as on the /bitget and /mexc history tabs. */
function TradeChartDialog({
  target,
  onChangeTf,
  onClose,
}: {
  target: ChartTarget;
  onChangeTf: (tf: string) => void;
  onClose: () => void;
}) {
  const { row, tf } = target;
  const { ex, t: trade } = row;
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
    const url = `${tradeChartUrl(row, tf)}&_t=${Date.now()}`;
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
  }, [row, tf]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function save(note: string) {
    setSaving(true);
    setSaveErr(null);
    try {
      const body = {
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
      };
      const rec = ex === 'bitget' ? await clientRef.current.saveBitgetTradeChart(body) : await clientRef.current.saveMexcTradeChart(body);
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
            <ExTag ex={ex} /> {trade.symbol} <span className="eb-tf">{tfLabel(tf)}</span>
            <span className="eb-chart-note"> · review lệnh đã đóng</span>
          </span>
          <div className="bg-tf-btns bg-tf-btns--dialog">
            {CHART_TIMEFRAMES.map(({ label, tf: t }) => (
              <button key={t} type="button" className={`bg-tf-btn ${t === tf ? 'bg-tf-btn--active' : ''}`} onClick={() => onChangeTf(t)}>
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
        <ChartNoteDialog saving={saving} error={saveErr} onSubmit={(note) => void save(note)} onCancel={() => setNotePrompt(false)} />
      )}
    </div>,
    document.body,
  );
}

function fmtSavedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Charts saved from ONE closed trade (by tradeKey, on its own exchange) — thumbnail rail + big image. */
function TradeChartGalleryDialog({ row, onClose }: { row: Row; onClose: () => void }) {
  const { ex, t: trade } = row;
  const clientRef = useRef(createApiClient());
  const [charts, setCharts] = useState<TradeChart[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setCharts(null);
    setFailed(false);
    const load =
      ex === 'bitget'
        ? clientRef.current.fetchBitgetSavedTradeCharts(trade.tradeKey)
        : clientRef.current.fetchMexcSavedTradeCharts(trade.tradeKey);
    load
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
  }, [ex, trade.tradeKey]);

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
            <ExTag ex={ex} /> {trade.symbol}{' '}
            <span className={`bg-side ${isLong ? 'bg-side--long' : 'bg-side--short'}`}>{isLong ? 'LONG' : 'SHORT'}</span>
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
              Chưa có chart nào được lưu từ lệnh này. Bấm “📈 Xem chart”, chọn khung rồi bấm “💾 Lưu” để lưu tham chiếu cho đúng lệnh
              này.
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
                    <a className="bg-gallery-main-img" href={active.url} target="_blank" rel="noreferrer" title="Mở ảnh gốc trong tab mới">
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
