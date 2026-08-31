'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { createApiClient } from '@web/shared/api/client';
import { ImageUpload, type ImageUploadValue } from '@web/shared/ui/image-upload/image-upload';
import type {
  StrategyBacktestBoard as BoardData,
  StrategyBacktestOrderType,
  StrategyBacktestSetup,
  StrategyBacktestSetupType,
  StrategyBacktestStatus,
} from '@web/shared/api/types';

import { computeSetupStats } from './setup-stats';

const apiClient = createApiClient();

/** The scan job runs every 5 minutes; refreshing more often only re-reads the same row. */
const REFRESH_MS = 60_000;

const STATUS_LABEL: Record<StrategyBacktestStatus, string> = {
  PENDING: 'Chờ khớp',
  ENTERED: 'Đã khớp',
  TP_HIT: 'Chạm TP',
  SL_HIT: 'Dính SL',
  CLOSED: 'Đóng tay',
  INVALID: 'Invalid',
};

const TYPE_LABEL: Record<StrategyBacktestSetupType, string> = {
  SWING: 'Swing',
  SCALP: 'Scalping',
};

const ORDER_LABEL: Record<StrategyBacktestOrderType, string> = {
  LIMIT: 'Limit',
  MARKET: 'Market',
};

const STATUS_MODIFIER: Record<StrategyBacktestStatus, string> = {
  PENDING: 'pending',
  ENTERED: 'active',
  TP_HIT: 'win',
  SL_HIT: 'loss',
  CLOSED: 'closed',
  INVALID: 'dead',
};

type Filter = 'all' | 'pending' | 'open' | 'done';

const FILTERS: { key: Filter; label: string; match: (s: StrategyBacktestSetup) => boolean }[] = [
  { key: 'all', label: 'Tất cả', match: () => true },
  { key: 'pending', label: 'Chờ khớp', match: (s) => s.status === 'PENDING' },
  { key: 'open', label: 'Đang chạy', match: (s) => s.status === 'ENTERED' },
  {
    key: 'done',
    label: 'Đã xong',
    match: (s) => s.status !== 'PENDING' && s.status !== 'ENTERED',
  },
];

/** Screenshot strip — the charts the setup was read off, click to open full size. */
function SetupImages({ urls }: { urls: string[] }) {
  const [lightbox, setLightbox] = useState<string | null>(null);

  if (urls.length === 0) return null;

  return (
    <>
      <div className="sbt-images">
        {urls.map((url) => (
          <button
            key={url}
            type="button"
            className="sbt-thumb"
            onClick={() => setLightbox(url)}
            aria-label="Xem ảnh setup"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="Chart setup" />
          </button>
        ))}
      </div>
      {lightbox ? (
        <div className="lightbox-backdrop" onClick={() => setLightbox(null)}>
          <button className="lightbox-close" onClick={() => setLightbox(null)} aria-label="Đóng">
            ✕
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt="Chart setup"
            className="lightbox-img"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </>
  );
}

function fmtPrice(value: number | null | undefined): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

function fmtPct(value: number | null | undefined, digits = 2): string {
  if (value == null) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

function fmtR(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}R`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  });
}

function signClass(value: number | null | undefined): string {
  if (value == null) return '';
  return value > 0 ? ' sbt-up' : value < 0 ? ' sbt-down' : '';
}

/** Parse a price input, tolerating the thousands separators a trader types. */
function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, '');
  if (cleaned === '') return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function SetupForm({
  livePrice,
  onCreated,
}: {
  livePrice: number | null;
  onCreated: (board: BoardData) => void;
}) {
  const [direction, setDirection] = useState<'LONG' | 'SHORT'>('LONG');
  const [setupType, setSetupType] = useState<StrategyBacktestSetupType>('SWING');
  const [orderType, setOrderType] = useState<StrategyBacktestOrderType>('LIMIT');
  const [entry, setEntry] = useState('');
  const [stop, setStop] = useState('');
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  // Remounts ImageUpload after a save so its internal previews are cleared with the form.
  const [uploaderKey, setUploaderKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMarket = orderType === 'MARKET';
  // A market setup is priced by the server at save time; the live price is only shown
  // here so the R:R preview has something to measure against.
  const entryPrice = isMarket ? livePrice : parseNumber(entry);
  const stopLoss = parseNumber(stop);
  const takeProfit = parseNumber(target);

  // Live R:R preview — the number that decides whether the setup is worth taking,
  // shown while it is still being typed rather than after it is saved.
  const plannedRr = useMemo(() => {
    if (entryPrice == null || stopLoss == null || takeProfit == null) return null;
    const risk = direction === 'LONG' ? entryPrice - stopLoss : stopLoss - entryPrice;
    const reward = direction === 'LONG' ? takeProfit - entryPrice : entryPrice - takeProfit;
    if (risk <= 0 || reward <= 0) return null;
    return reward / risk;
  }, [direction, entryPrice, stopLoss, takeProfit]);

  const submit = async () => {
    if (stopLoss == null) {
      setError('Cần nhập stop loss.');
      return;
    }
    if (!isMarket && entryPrice == null) {
      setError('Lệnh limit cần giá entry.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Upload first: a setup that saved but lost its charts would be the worse outcome,
      // so a failed upload aborts before anything is written.
      const images = pendingFiles.length
        ? await apiClient.uploadImages(pendingFiles, 'BTCUSDT')
        : [];

      await apiClient.createStrategyBacktestSetup({
        direction,
        setupType,
        orderType,
        // Left out for MARKET on purpose: the server reads the live price itself, so the
        // entry can never be a level that did not actually trade.
        ...(isMarket ? {} : { entryPrice: entryPrice as number }),
        stopLoss,
        ...(takeProfit != null ? { takeProfit } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(images.length ? { images } : {}),
      });
      onCreated(await apiClient.fetchStrategyBacktestBoard());
      setEntry('');
      setStop('');
      setTarget('');
      setNote('');
      setPendingFiles([]);
      setUploaderKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được setup');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="sbt-form">
      <h2 className="sbt-section-title">Thêm setup</h2>

      <div className="sbt-form-grid">
        <div className="sbt-field">
          <label className="sbt-label">Hướng</label>
          <div className="sbt-dir-toggle">
            <button
              type="button"
              className={`sbt-dir-btn${direction === 'LONG' ? ' is-active is-long' : ''}`}
              onClick={() => setDirection('LONG')}
            >
              ▲ Long
            </button>
            <button
              type="button"
              className={`sbt-dir-btn${direction === 'SHORT' ? ' is-active is-short' : ''}`}
              onClick={() => setDirection('SHORT')}
            >
              ▼ Short
            </button>
          </div>
        </div>

        <div className="sbt-field">
          <label className="sbt-label">Loại lệnh</label>
          <div className="sbt-dir-toggle">
            <button
              type="button"
              className={`sbt-dir-btn${setupType === 'SWING' ? ' is-active is-type' : ''}`}
              onClick={() => setSetupType('SWING')}
            >
              Swing
            </button>
            <button
              type="button"
              className={`sbt-dir-btn${setupType === 'SCALP' ? ' is-active is-type' : ''}`}
              onClick={() => setSetupType('SCALP')}
            >
              Scalping
            </button>
          </div>
        </div>

        <div className="sbt-field">
          <label className="sbt-label">Kiểu vào lệnh</label>
          <div className="sbt-dir-toggle">
            <button
              type="button"
              className={`sbt-dir-btn${!isMarket ? ' is-active is-type' : ''}`}
              onClick={() => setOrderType('LIMIT')}
            >
              Limit
            </button>
            <button
              type="button"
              className={`sbt-dir-btn${isMarket ? ' is-active is-type' : ''}`}
              onClick={() => setOrderType('MARKET')}
            >
              Market
            </button>
          </div>
        </div>

        <div className="sbt-field">
          <label className="sbt-label" htmlFor="sbt-entry">
            {isMarket ? 'Entry (giá thị trường)' : 'Entry (limit)'}
          </label>
          {isMarket ? (
            <div className="sbt-market-entry" aria-live="polite">
              <span className="sbt-market-price">{fmtPrice(livePrice)}</span>
              <span className="sbt-market-hint">
                {livePrice == null ? 'chưa lấy được giá' : 'vào lệnh ngay khi lưu'}
              </span>
            </div>
          ) : (
            <input
              id="sbt-entry"
              className="sbt-input"
              inputMode="decimal"
              placeholder="vd. 108500"
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
            />
          )}
        </div>

        <div className="sbt-field">
          <label className="sbt-label" htmlFor="sbt-stop">Stop loss</label>
          <input
            id="sbt-stop"
            className="sbt-input"
            inputMode="decimal"
            placeholder="vd. 106000"
            value={stop}
            onChange={(e) => setStop(e.target.value)}
          />
        </div>

        <div className="sbt-field">
          <label className="sbt-label" htmlFor="sbt-tp">Take profit</label>
          <input
            id="sbt-tp"
            className="sbt-input"
            inputMode="decimal"
            placeholder="bỏ trống = chạy tới SL"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </div>

        <div className="sbt-field sbt-field--wide">
          <label className="sbt-label" htmlFor="sbt-note">Lý do vào lệnh</label>
          <textarea
            id="sbt-note"
            className="sbt-input sbt-textarea"
            rows={2}
            placeholder="Ghi lại vì sao setup này đáng vào — để sau còn chấm lại."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className="sbt-field sbt-field--wide">
          <label className="sbt-label">Ảnh chart</label>
          <ImageUpload
            key={uploaderKey}
            onChange={(value: ImageUploadValue) => setPendingFiles(value.newFiles)}
            uploading={saving}
          />
        </div>
      </div>

      <div className="sbt-form-footer">
        <span className="sbt-rr-preview">
          R:R dự kiến <strong>{plannedRr != null ? `${plannedRr.toFixed(2)}` : '—'}</strong>
          {isMarket ? (
            <span className="sbt-rr-note"> · tính theo giá thị trường lúc này</span>
          ) : null}
        </span>
        <button type="button" className="sbt-btn sbt-btn--primary" onClick={submit} disabled={saving}>
          {saving ? 'Đang lưu…' : isMarket ? 'Vào lệnh market' : 'Thêm setup limit'}
        </button>
      </div>

      {error ? <p className="sbt-error">{error}</p> : null}
    </section>
  );
}

/**
 * Asks for the reason before calling a setup off. Portalled to document.body — the
 * setup card is a `card`-style surface, and a fixed overlay rendered inside one gets
 * trapped by its stacking context.
 */
function InvalidDialog({
  setup,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  setup: StrategyBacktestSetup;
  busy: boolean;
  error: string | null;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog dialog--compact" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">
            Đánh dấu invalid — {setup.direction === 'LONG' ? 'Long' : 'Short'} {setup.symbol}
          </span>
          <button className="dialog-close" onClick={onClose} aria-label="Đóng">
            ✕
          </button>
        </div>

        <div className="dialog-body">
          <p className="dialog-confirm-text">
            Lệnh sẽ ngừng được theo dõi và không tính vào thống kê, nhưng vẫn nằm trên bảng để
            xem lại sau.
          </p>

          <div className="sbt-field">
            <label className="sbt-label" htmlFor={`sbt-reason-${setup.id}`}>
              Lý do (không bắt buộc)
            </label>
            <textarea
              id={`sbt-reason-${setup.id}`}
              className="sbt-input sbt-textarea"
              rows={3}
              autoFocus
              placeholder="vd. cấu trúc gãy, tin ra khác kịch bản, vào nhầm vùng…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          {error ? <p className="sbt-error">{error}</p> : null}

          <div className="dialog-confirm-actions">
            <button type="button" className="sbt-btn" onClick={onClose} disabled={busy}>
              Thôi
            </button>
            <button
              type="button"
              className="sbt-btn sbt-btn--warn"
              disabled={busy}
              onClick={() => onConfirm(reason)}
            >
              {busy ? 'Đang lưu…' : 'Đánh dấu invalid'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SetupCard({
  setup,
  onChanged,
}: {
  setup: StrategyBacktestSetup;
  onChanged: (board: BoardData) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidating, setInvalidating] = useState(false);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged(await apiClient.fetchStrategyBacktestBoard());
      // Only closes on success — a failed call keeps the dialog open with its message.
      setInvalidating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Thao tác thất bại');
    } finally {
      setBusy(false);
    }
  };

  const isPending = setup.status === 'PENDING';
  const isOpen = setup.status === 'ENTERED';
  const result = setup.pnlPct ?? setup.unrealizedPct;
  const resultR = setup.rMultiple ?? setup.unrealizedR;

  return (
    <article className={`sbt-card sbt-card--${STATUS_MODIFIER[setup.status]}`}>
      <header className="sbt-card-head">
        <span className={`sbt-dir sbt-dir--${setup.direction.toLowerCase()}`}>
          {setup.direction === 'LONG' ? '▲ Long' : '▼ Short'}
        </span>
        <span className="sbt-symbol">{setup.symbol}</span>
        <span className={`sbt-type sbt-type--${setup.setupType.toLowerCase()}`}>
          {TYPE_LABEL[setup.setupType]}
        </span>
        <span className={`sbt-order sbt-order--${setup.orderType.toLowerCase()}`}>
          {ORDER_LABEL[setup.orderType]}
        </span>
        <span className={`sbt-status sbt-status--${STATUS_MODIFIER[setup.status]}`}>
          {STATUS_LABEL[setup.status]}
        </span>
        {result != null ? (
          <span className={`sbt-result${signClass(result)}`}>
            {fmtPct(result)} <span className="sbt-result-r">{fmtR(resultR)}</span>
          </span>
        ) : null}
      </header>

      <div className="sbt-prices">
        <div className="sbt-price">
          <span className="sbt-price-label">
            {setup.orderType === 'MARKET' ? 'Entry (market)' : 'Entry'}
          </span>
          <span className="sbt-price-value">{fmtPrice(setup.entryPrice)}</span>
        </div>
        <div className="sbt-price">
          <span className="sbt-price-label">SL</span>
          <span className="sbt-price-value sbt-down">{fmtPrice(setup.stopLoss)}</span>
        </div>
        <div className="sbt-price">
          <span className="sbt-price-label">TP</span>
          <span className="sbt-price-value sbt-up">{fmtPrice(setup.takeProfit)}</span>
        </div>
        <div className="sbt-price">
          <span className="sbt-price-label">R:R</span>
          <span className="sbt-price-value">
            {setup.plannedRr != null ? setup.plannedRr.toFixed(2) : '—'}
          </span>
        </div>
        {setup.exitPrice != null ? (
          <div className="sbt-price">
            <span className="sbt-price-label">Thoát</span>
            <span className="sbt-price-value">{fmtPrice(setup.exitPrice)}</span>
          </div>
        ) : null}
      </div>

      <div className="sbt-meta">
        <span>Tạo {fmtTime(setup.createdAt)}</span>
        {setup.triggeredAt ? <span>Khớp {fmtTime(setup.triggeredAt)}</span> : null}
        {setup.closedAt ? <span>Đóng {fmtTime(setup.closedAt)}</span> : null}
        {isPending && setup.distanceToEntryPct != null ? (
          <span className="sbt-distance">
            Còn cách entry <strong>{fmtPct(setup.distanceToEntryPct)}</strong>
          </span>
        ) : null}
        {setup.lastCheckedAt ? <span>Quét lúc {fmtTime(setup.lastCheckedAt)}</span> : null}
      </div>

      {setup.invalidReason ? (
        <p className="sbt-invalid-reason">
          <strong>Lý do invalid:</strong> {setup.invalidReason}
        </p>
      ) : null}

      {setup.note ? <p className="sbt-note">{setup.note}</p> : null}

      <SetupImages urls={setup.images} />

      <footer className="sbt-actions">
        {isOpen ? (
          <button
            type="button"
            className="sbt-btn"
            disabled={busy}
            onClick={() => void run(() => apiClient.closeStrategyBacktestSetup(setup.id))}
          >
            Đóng ở giá hiện tại
          </button>
        ) : null}
        {isPending || isOpen ? (
          <button
            type="button"
            className="sbt-btn sbt-btn--warn"
            disabled={busy}
            title="Setup không còn hợp lệ — ngừng theo dõi và không tính vào thống kê"
            onClick={() => {
              setError(null);
              setInvalidating(true);
            }}
          >
            Invalid
          </button>
        ) : null}
      </footer>

      {/* The card's own error line; while the dialog is open its message shows in there. */}
      {error && !invalidating ? <p className="sbt-error">{error}</p> : null}

      {invalidating ? (
        <InvalidDialog
          setup={setup}
          busy={busy}
          error={error}
          onClose={() => {
            setInvalidating(false);
            setError(null);
          }}
          onConfirm={(reason) =>
            void run(() => apiClient.invalidateStrategyBacktestSetup(setup.id, reason))
          }
        />
      ) : null}
    </article>
  );
}

function StatsRow({ setups }: { setups: StrategyBacktestSetup[] }) {
  const stats = useMemo(() => computeSetupStats(setups), [setups]);

  const cells: { label: string; value: string; className?: string }[] = [
    { label: 'Đã lên kế hoạch', value: String(stats.planned) },
    { label: 'Chờ khớp', value: String(stats.pending) },
    { label: 'Đang chạy', value: String(stats.open) },
    { label: 'Huỷ / invalid', value: String(stats.dropped) },
    {
      label: `Win rate (${stats.wins}/${stats.scored})`,
      value: stats.winRate != null ? `${(stats.winRate * 100).toFixed(0)}%` : '—',
    },
    {
      label: 'Tỉ lệ khớp',
      value: stats.fillRate != null ? `${(stats.fillRate * 100).toFixed(0)}%` : '—',
    },
    {
      label: 'Tổng R',
      value: fmtR(stats.totalR),
      className: signClass(stats.totalR),
    },
    {
      label: 'R trung bình',
      value: fmtR(stats.avgR),
      className: signClass(stats.avgR),
    },
    {
      label: 'Tổng % (đã trừ phí)',
      value: fmtPct(stats.totalPnlPct),
      className: signClass(stats.totalPnlPct),
    },
  ];

  return (
    <section className="sbt-stats">
      {cells.map((cell) => (
        <div key={cell.label} className="sbt-stat">
          <span className="sbt-stat-label">{cell.label}</span>
          <span className={`sbt-stat-value${cell.className ?? ''}`}>{cell.value}</span>
        </div>
      ))}
    </section>
  );
}

export function StrategyBacktestBoard({ initialBoard }: { initialBoard: BoardData }) {
  const [board, setBoard] = useState<BoardData>(initialBoard);
  const [filter, setFilter] = useState<Filter>('all');

  const refresh = useCallback(async () => {
    try {
      setBoard(await apiClient.fetchStrategyBacktestBoard());
    } catch {
      // Keep whatever is on screen — the next tick retries.
    }
  }, []);

  // The worker advances setups on its own cron, so the page has to poll to see it.
  useEffect(() => {
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const visible = useMemo(() => {
    const match = FILTERS.find((f) => f.key === filter)?.match ?? (() => true);
    return board.setups.filter(match);
  }, [board.setups, filter]);

  return (
    <div className="sbt-page">
      <header className="sbt-header">
        <div>
          <h1 className="sbt-title">Strategy Backtest</h1>
          <p className="sbt-subtitle">
            Setup {board.symbol} tự phân tích bằng tay. Job quét mỗi 5 phút bằng nến 5m để xem lệnh
            có khớp, chạm TP hay dính SL — không tự vào lệnh, chỉ theo dõi.
          </p>
        </div>
        <div className="sbt-price-now">
          <span className="sbt-price-now-label">{board.symbol}</span>
          <span className="sbt-price-now-value">{fmtPrice(board.price)}</span>
        </div>
      </header>

      <StatsRow setups={board.setups} />

      <SetupForm livePrice={board.price} onCreated={setBoard} />

      <div className="sbt-filters">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`sbt-chip${filter === f.key ? ' is-active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            <span className="sbt-chip-count">{board.setups.filter(f.match).length}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="sbt-empty">Chưa có setup nào ở mục này.</p>
      ) : (
        <div className="sbt-list">
          {visible.map((setup) => (
            <SetupCard key={setup.id} setup={setup} onChanged={setBoard} />
          ))}
        </div>
      )}
    </div>
  );
}
