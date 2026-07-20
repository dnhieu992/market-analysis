'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { createApiClient, resolveApiBaseUrl } from '@web/shared/api/client';
import type {
  BitgetHistoryResponse,
  BitgetPositionsResponse,
  BitgetSetupConfig,
  BitgetQqeTfSignal,
} from '@web/shared/api/types';

import { useBitgetLivePrices } from '../bitget-positions/use-bitget-live-prices';

const REFRESH_MS = 15_000;
// QQE readings only change on candle close — poll on a slower cadence than positions.
const QQE_REFRESH_MS = 60_000;

const CHART_TIMEFRAMES = [
  { label: 'M30', tf: 'M30' },
  { label: 'H1',  tf: '1h'  },
  { label: 'H4',  tf: '4h'  },
  { label: 'D1',  tf: '1d'  },
] as const;

/** Per-coin QQE state keyed by timeframe, matching the chart-view timeframes. */
type QqeMap = Record<string, Record<string, BitgetQqeTfSignal | null>>;

/** Renders the M30/H1/H4/D1 QQE badges for one coin's Setup row cell. */
function QqeCell({ signals }: { signals: Record<string, BitgetQqeTfSignal | null> | undefined }) {
  return (
    <div className="bg-qqe-grid">
      {CHART_TIMEFRAMES.map(({ label, tf }) => {
        const sig = signals?.[tf] ?? null;
        const cls = sig ? (sig.state === 'long' ? 'bg-qqe--long' : 'bg-qqe--short') : 'bg-qqe--na';
        const mark = sig ? (sig.state === 'long' ? 'L' : 'S') : '–';
        const title = sig
          ? `${label}: QQE ${sig.state === 'long' ? 'Long' : 'Short'}` +
            (sig.freshCross
              ? ' · vừa đảo chiều'
              : sig.barsSince != null
                ? ` · ${sig.barsSince} nến trước`
                : '')
          : `${label}: chưa có dữ liệu`;
        return (
          <span
            key={tf}
            className={`bg-qqe-badge ${cls}${sig?.freshCross ? ' bg-qqe--fresh' : ''}`}
            title={title}
          >
            <span className="bg-qqe-tf">{label}</span>
            <span className="bg-qqe-sig">{mark}</span>
          </span>
        );
      })}
    </div>
  );
}

type ChartTarget = { symbol: string; tf: string };

type HoldSide = 'long' | 'short';

/** Per-coin, per-side config keyed by `${symbol}-${holdSide}`. */
type ConfigMap = Record<string, BitgetSetupConfig>;

const cfgKey = (symbol: string, holdSide: HoldSide) => `${symbol}-${holdSide}`;

function fmtUsdPlain(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Adaptive precision so both $60,000 BTC and $0.0000123 coins read cleanly. */
function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 3 : abs >= 0.01 ? 5 : 8;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** 24h change ratio (0.0123) → signed percent string. */
function fmtChange(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return '—';
  const pct = ratio * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

type Props = {
  history: BitgetHistoryResponse;
  positions: BitgetPositionsResponse;
  embedded?: boolean;
};

/**
 * Setup tab: one row per coin ever traded, with a separate LONG and SHORT
 * action cell. Each side carries its own manual-open config (leverage / margin,
 * always cross) persisted in the DB, its own ⚙ Setup dialog, and its own
 * open button. The Long/Short button is disabled independently while that exact
 * coin+side already has an open position, or until the side's margin has been
 * configured — so an open long disables only Long, leaving Short live.
 */
export function BitgetSetupFeed({ history, positions: initialPositions, embedded = false }: Props) {
  const clientRef = useRef(createApiClient());
  const [positions, setPositions] = useState<BitgetPositionsResponse>(initialPositions);
  const [configs, setConfigs] = useState<ConfigMap>({});
  const [editing, setEditing] = useState<{ symbol: string; holdSide: HoldSide } | null>(null);
  const [chartTarget, setChartTarget] = useState<ChartTarget | null>(null);
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [qqe, setQqe] = useState<QqeMap>({});

  // Hydrate saved configs from the DB (survives reloads, shared across devices).
  useEffect(() => {
    let alive = true;
    clientRef.current
      .fetchBitgetSetupConfigs()
      .then((list) => {
        if (!alive) return;
        const map: ConfigMap = {};
        for (const c of list) map[cfgKey(c.symbol, c.holdSide)] = c;
        setConfigs(map);
      })
      .catch(() => {
        /* non-fatal: rows just show as unconfigured until saved */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Unique symbols across every trade in history, newest-first by most recent close.
  const symbols = useMemo(() => {
    const lastClose = new Map<string, number>();
    for (const t of history.trades) {
      const ts = new Date(t.closedAt).getTime();
      const prev = lastClose.get(t.symbol) ?? 0;
      if (ts > prev) lastClose.set(t.symbol, ts);
    }
    return [...lastClose.keys()].sort((a, b) => (lastClose.get(b) ?? 0) - (lastClose.get(a) ?? 0));
  }, [history.trades]);

  // (symbol, side) pairs with a live open position on the exchange → Open disabled.
  const openSides = useMemo(
    () => new Set(positions.positions.map((p) => cfgKey(p.symbol, p.holdSide))),
    [positions.positions],
  );

  // Realtime last price + 24h change per coin, straight from Bitget's public WS.
  const { prices: livePrices, changes: liveChanges, live } = useBitgetLivePrices(symbols);

  const refreshPositions = useCallback(async () => {
    try {
      const next = await clientRef.current.fetchBitgetPositions();
      setPositions(next);
    } catch {
      /* keep last-known positions; non-fatal for this tab */
    }
  }, []);

  useEffect(() => {
    const id = setInterval(refreshPositions, REFRESH_MS);
    return () => clearInterval(id);
  }, [refreshPositions]);

  const refreshQqe = useCallback(async (syms: string[]) => {
    if (syms.length === 0) return;
    try {
      const rows = await clientRef.current.fetchBitgetQqeSignals(syms);
      setQqe((prev) => {
        const next = { ...prev };
        for (const r of rows) next[r.symbol] = r.signals;
        return next;
      });
    } catch {
      /* non-fatal: the QQE column just keeps its last-known (or empty) badges */
    }
  }, []);

  // Fetch QQE signals for the listed coins on mount / when the set changes, then
  // refresh on a slower cadence (readings only move on candle close).
  useEffect(() => {
    if (symbols.length === 0) return;
    void refreshQqe(symbols);
    const id = setInterval(() => void refreshQqe(symbols), QQE_REFRESH_MS);
    return () => clearInterval(id);
  }, [symbols, refreshQqe]);

  const saveConfig = useCallback(
    async (symbol: string, holdSide: HoldSide, cfg: { leverage: number; marginUsd: number }) => {
      const next: BitgetSetupConfig = { symbol, holdSide, ...cfg };
      // Optimistic update so the row reflects the new config immediately.
      setConfigs((prev) => ({ ...prev, [cfgKey(symbol, holdSide)]: next }));
      setError(null);
      try {
        await clientRef.current.saveBitgetSetupConfig(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Lưu cấu hình thất bại. Thử lại sau.');
      }
    },
    [],
  );

  const openPosition = useCallback(
    async (symbol: string, holdSide: HoldSide) => {
      const cfg = configs[cfgKey(symbol, holdSide)];
      if (!cfg || !(cfg.marginUsd > 0)) {
        setError(`Cấu hình ký quỹ cho ${symbol} (${holdSide.toUpperCase()}) trước khi mở lệnh.`);
        return;
      }
      if (
        !window.confirm(
          `Mở lệnh ${holdSide.toUpperCase()} ${symbol} theo giá market ngay bây giờ?\n` +
            `Ký quỹ $${cfg.marginUsd} · đòn bẩy ${cfg.leverage}× · cross`,
        )
      ) {
        return;
      }
      const key = cfgKey(symbol, holdSide);
      setOpeningKey(key);
      setError(null);
      setNotice(null);
      try {
        const res = await clientRef.current.openBitgetPosition({
          symbol,
          holdSide,
          marginUsd: cfg.marginUsd,
          leverage: cfg.leverage,
        });
        setNotice(
          `Đã mở ${res.holdSide.toUpperCase()} ${symbol}: size ${res.size} @ ~${res.entryPrice}.`,
        );
        await refreshPositions();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Mở lệnh thất bại. Thử lại sau.');
      } finally {
        setOpeningKey(null);
      }
    },
    [configs, refreshPositions],
  );

  const configured = history.configured || positions.configured;
  const sides: HoldSide[] = ['long', 'short'];

  return (
    <div className={embedded ? 'bg-panel' : 'page'}>
      <div className="bg-head">
        <div>
          {!embedded && <h1>Bitget · Setup mở lệnh</h1>}
          <p className="bg-sub">
            Mở lệnh nhanh theo giá market (cross) — mỗi coin có nút Long/Short riêng, cấu hình từng hướng được lưu lại.
          </p>
        </div>
        <div className="bg-head-actions">
          <span className={`bg-live ${live ? 'bg-live--on' : ''}`} title="Giá realtime từ Bitget WS">
            <span className="bg-live-dot" />
            {live ? 'Realtime' : 'Đang kết nối…'}
          </span>
          <button className="bg-refresh" onClick={refreshPositions}>
            ↻ Làm mới
          </button>
        </div>
      </div>

      {error && <div className="bg-alert bg-alert--error">{error}</div>}
      {notice && <div className="bg-alert bg-alert--ok">{notice}</div>}

      {!configured ? (
        <div className="bg-alert">
          Chưa cấu hình Bitget API. Thêm <code>BITGET_API_KEY</code>, <code>BITGET_API_SECRET</code>,{' '}
          <code>BITGET_API_PASSPHRASE</code> vào <code>.env</code> để mở lệnh.
        </div>
      ) : symbols.length === 0 ? (
        <div className="bg-alert">
          Chưa có coin nào trong lịch sử. Khi có lệnh đã đóng, chúng sẽ hiện ở đây để mở lại nhanh.
        </div>
      ) : (
        <div className="bg-table-wrap">
          <table className="bg-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th className="bg-num">Giá</th>
                <th className="bg-num" title="Thay đổi so với mốc 00:00 UTC">
                  Hôm nay
                </th>
                <th title="Tín hiệu QQE Signals (colinmck) trên nến đã đóng — L=Long (xanh) / S=Short (đỏ) theo từng khung M30/H1/H4/D1">
                  QQE
                </th>
                <th>Long</th>
                <th>Short</th>
              </tr>
            </thead>
            <tbody>
              {symbols.map((symbol) => {
                const price = livePrices[symbol];
                const change = liveChanges[symbol];
                const changeCls =
                  change == null || !Number.isFinite(change)
                    ? ''
                    : change > 0
                      ? 'bg-chg--up'
                      : change < 0
                        ? 'bg-chg--down'
                        : '';
                return (
                  <tr key={symbol}>
                    <td className="bg-symbol">
                      <div className="bg-symbol-cell">
                        <span>{symbol}</span>
                        <div className="bg-chart-btns">
                          {CHART_TIMEFRAMES.map(({ label, tf }) => (
                            <button
                              key={tf}
                              type="button"
                              className="bg-chart-btn"
                              onClick={() => setChartTarget({ symbol, tf })}
                              title={`Xem chart ${label} (SonicR + S/R Channel + RSI)`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </td>
                    <td className="bg-num bg-price">{fmtPrice(price)}</td>
                    <td className={`bg-num ${changeCls}`}>{fmtChange(change)}</td>
                    <td className="bg-qqe-cell">
                      <QqeCell signals={qqe[symbol]} />
                    </td>
                    {sides.map((holdSide) => {
                      const key = cfgKey(symbol, holdSide);
                      const cfg = configs[key];
                      const isOpen = openSides.has(key);
                      const configuredSide = Boolean(cfg && cfg.marginUsd > 0);
                      const opening = openingKey === key;
                      const isLong = holdSide === 'long';
                      return (
                        <td key={holdSide} className="bg-side-cell">
                          <div className="bg-side-cell-inner">
                            <div className="bg-side-cfg-row">
                              {isOpen ? (
                                <span className="bg-status-open">● Đang mở</span>
                              ) : configuredSide ? (
                                <span className="bg-side-cfg">
                                  {cfg!.leverage}× · {fmtUsdPlain(cfg!.marginUsd)} · cross
                                </span>
                              ) : (
                                <span className="bg-side-cfg bg-side-cfg--empty">chưa cấu hình</span>
                              )}
                            </div>
                            <div className="bg-setup-actions">
                              <button
                                type="button"
                                className="bg-setup-btn"
                                onClick={() => setEditing({ symbol, holdSide })}
                                title={`Cấu hình ${isLong ? 'LONG' : 'SHORT'} — đòn bẩy / ký quỹ`}
                              >
                                ⚙
                              </button>
                              <button
                                type="button"
                                className={`bg-open-btn ${isLong ? 'bg-open-btn--long' : 'bg-open-btn--short'}`}
                                onClick={() => openPosition(symbol, holdSide)}
                                disabled={isOpen || !configuredSide || opening || openingKey !== null}
                                title={
                                  isOpen
                                    ? 'Hướng này đang có vị thế mở'
                                    : !configuredSide
                                      ? 'Cấu hình ký quỹ trước'
                                      : `Mở lệnh ${isLong ? 'LONG' : 'SHORT'} market`
                                }
                              >
                                {opening ? '…' : isLong ? 'Long' : 'Short'}
                              </button>
                            </div>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <SetupDialog
          symbol={editing.symbol}
          holdSide={editing.holdSide}
          initial={configs[cfgKey(editing.symbol, editing.holdSide)]}
          onSave={(cfg) => {
            void saveConfig(editing.symbol, editing.holdSide, cfg);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}

      {chartTarget && (
        <SetupChartDialog symbol={chartTarget.symbol} tf={chartTarget.tf} onClose={() => setChartTarget(null)} />
      )}
    </div>
  );
}

/**
 * Fullscreen M30 chart dialog for a Setup-tab coin (SonicR system + S/R channels
 * + RSI, all TradingView defaults). The PNG is rendered server-side; we fetch it
 * through the app's authenticated path and show it as a blob URL. Read-only —
 * nothing is persisted.
 */
function SetupChartDialog({ symbol, tf, onClose }: { symbol: string; tf: string; onClose: () => void }) {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // Friendly label for the dialog title (M30→M30, 1h→H1, 4h→H4, 1d→D1)
  const tfLabel = tf === '1h' ? 'H1' : tf === '4h' ? 'H4' : tf === '1d' ? 'D1' : tf.toUpperCase();

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setImgSrc(null);
    setFailed(false);
    const url = `${resolveApiBaseUrl()}/bitget/setup-chart?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(tf)}&_t=${Date.now()}`;
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
  }, [symbol, tf]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog dialog--fullscreen eb-chart-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">
            {symbol} <span className="eb-tf">{tfLabel}</span>
            <span className="eb-chart-note"> · SonicR + S/R Channel + RSI</span>
          </span>
          <button className="dialog-close" onClick={onClose} aria-label="Đóng">
            ✕
          </button>
        </div>
        <div className="dialog-body eb-chart-body">
          {failed ? (
            <div className="eb-chart-status">Không tải được chart. Thử lại sau.</div>
          ) : imgSrc ? (
            <img className="eb-chart-img" src={imgSrc} alt={`${symbol} ${tfLabel} chart`} />
          ) : (
            <div className="eb-chart-status">Đang tải chart…</div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

const DEFAULT_LEVERAGE = 10;

function SetupDialog({
  symbol,
  holdSide,
  initial,
  onSave,
  onClose,
}: {
  symbol: string;
  holdSide: HoldSide;
  initial: BitgetSetupConfig | undefined;
  onSave: (cfg: { leverage: number; marginUsd: number }) => void;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [leverage, setLeverage] = useState(String(initial?.leverage ?? DEFAULT_LEVERAGE));
  const [marginUsd, setMarginUsd] = useState(
    initial && initial.marginUsd > 0 ? String(initial.marginUsd) : '',
  );

  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const lev = Number(leverage);
  const margin = Number(marginUsd);
  const valid = Number.isFinite(lev) && lev >= 1 && lev <= 125 && Number.isFinite(margin) && margin > 0;
  const notional = valid ? margin * lev : 0;
  const isLong = holdSide === 'long';

  if (!mounted) return null;

  return createPortal(
    <div className="bg-setup-overlay" onClick={onClose}>
      <div
        className="bg-setup-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Cấu hình ${symbol} ${holdSide}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-setup-head">
          <h3>
            Cấu hình {symbol}{' '}
            <span className={`bg-side ${isLong ? 'bg-side--long' : 'bg-side--short'}`}>
              {isLong ? 'LONG' : 'SHORT'}
            </span>
          </h3>
          <button type="button" className="bg-setup-x" onClick={onClose} aria-label="Đóng">
            ×
          </button>
        </div>

        <div className="bg-setup-body">
          <label className="bg-setup-field">
            <span>Đòn bẩy (×)</span>
            <input
              type="number"
              min={1}
              max={125}
              step={1}
              value={leverage}
              onChange={(e) => setLeverage(e.target.value)}
            />
          </label>

          <label className="bg-setup-field">
            <span>Loại lệnh / Margin</span>
            <input type="text" value="Market · Cross" disabled />
          </label>

          <label className="bg-setup-field">
            <span>Ký quỹ (USDT)</span>
            <input
              type="number"
              min={0}
              step="any"
              value={marginUsd}
              placeholder="vd: 20"
              onChange={(e) => setMarginUsd(e.target.value)}
            />
          </label>

          <p className="bg-setup-note">
            Giá trị lệnh (notional) ≈{' '}
            <strong>{valid ? `$${notional.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—'}</strong>{' '}
            = ký quỹ × đòn bẩy. Size sẽ được tính theo giá market khi bấm Open.
          </p>
        </div>

        <div className="bg-setup-foot">
          <button type="button" className="bg-setup-cancel" onClick={onClose}>
            Huỷ
          </button>
          <button
            type="button"
            className="bg-setup-save"
            disabled={!valid}
            onClick={() => onSave({ leverage: lev, marginUsd: margin })}
          >
            Lưu
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
