'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { createApiClient } from '@web/shared/api/client';
import type {
  BitgetHistoryResponse,
  BitgetPositionsResponse,
  BitgetSetupConfig,
} from '@web/shared/api/types';

import { useBitgetLivePrices } from '../bitget-positions/use-bitget-live-prices';

const REFRESH_MS = 15_000;
const CONFIG_KEY = 'bitget:setup-config';

const DEFAULT_CONFIG: BitgetSetupConfig = { holdSide: 'long', leverage: 10, marginUsd: 0 };

type ConfigMap = Record<string, BitgetSetupConfig>;

function loadConfigs(): ConfigMap {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ConfigMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

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
 * Setup tab: one row per coin ever traded (unique symbols from the history feed).
 * Each row carries a per-coin manual-open config (direction / leverage / margin,
 * always cross) stored in localStorage. "Open" places a live market order via the
 * API; it's disabled while that coin already has an open position, or until the
 * coin's margin has been configured.
 */
export function BitgetSetupFeed({ history, positions: initialPositions, embedded = false }: Props) {
  const clientRef = useRef(createApiClient());
  const [positions, setPositions] = useState<BitgetPositionsResponse>(initialPositions);
  const [configs, setConfigs] = useState<ConfigMap>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setConfigs(loadConfigs());
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

  // Symbols with a live open position on the exchange (either side) → Open disabled.
  const openSymbols = useMemo(
    () => new Set(positions.positions.map((p) => p.symbol)),
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

  const saveConfig = useCallback((symbol: string, cfg: BitgetSetupConfig) => {
    setConfigs((prev) => {
      const next = { ...prev, [symbol]: cfg };
      try {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
      } catch {
        /* ignore quota / private-mode errors */
      }
      return next;
    });
  }, []);

  const openPosition = useCallback(
    async (symbol: string) => {
      const cfg = configs[symbol];
      if (!cfg || !(cfg.marginUsd > 0)) {
        setError(`Cấu hình ký quỹ cho ${symbol} trước khi mở lệnh.`);
        return;
      }
      if (
        !window.confirm(
          `Mở lệnh ${cfg.holdSide.toUpperCase()} ${symbol} theo giá market ngay bây giờ?\n` +
            `Ký quỹ $${cfg.marginUsd} · đòn bẩy ${cfg.leverage}× · cross`,
        )
      ) {
        return;
      }
      setOpeningKey(symbol);
      setError(null);
      setNotice(null);
      try {
        const res = await clientRef.current.openBitgetPosition({
          symbol,
          holdSide: cfg.holdSide,
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

  return (
    <div className={embedded ? 'bg-panel' : 'page'}>
      <div className="bg-head">
        <div>
          {!embedded && <h1>Bitget · Setup mở lệnh</h1>}
          <p className="bg-sub">
            Mở lệnh nhanh theo giá market (cross) cho các coin đã từng giao dịch.
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
                <th className="bg-num">24h</th>
                <th>Hướng</th>
                <th className="bg-num">Đòn bẩy</th>
                <th>Ký quỹ</th>
                <th className="bg-num">Ký quỹ (USDT)</th>
                <th className="bg-num">Trạng thái</th>
                <th className="bg-num">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {symbols.map((symbol) => {
                const cfg = configs[symbol];
                const isOpen = openSymbols.has(symbol);
                const configuredCoin = Boolean(cfg && cfg.marginUsd > 0);
                const opening = openingKey === symbol;
                const isLong = (cfg?.holdSide ?? 'long') === 'long';
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
                    <td className="bg-symbol">{symbol}</td>
                    <td className="bg-num bg-price">{fmtPrice(price)}</td>
                    <td className={`bg-num ${changeCls}`}>{fmtChange(change)}</td>
                    <td>
                      <span className={`bg-side ${isLong ? 'bg-side--long' : 'bg-side--short'}`}>
                        {isLong ? 'LONG' : 'SHORT'}
                      </span>
                    </td>
                    <td className="bg-num">{cfg ? `${cfg.leverage}×` : '—'}</td>
                    <td>
                      <span className="bg-margin-mode">cross</span>
                    </td>
                    <td className="bg-num">{configuredCoin ? fmtUsdPlain(cfg!.marginUsd) : '—'}</td>
                    <td className="bg-num">
                      {isOpen ? (
                        <span className="bg-status-open">Đang mở</span>
                      ) : (
                        <span className="bg-status-flat">—</span>
                      )}
                    </td>
                    <td className="bg-num">
                      <div className="bg-setup-actions">
                        <button
                          type="button"
                          className="bg-setup-btn"
                          onClick={() => setEditing(symbol)}
                          title="Cấu hình đòn bẩy / ký quỹ"
                        >
                          ⚙ Setup
                        </button>
                        <button
                          type="button"
                          className="bg-open-btn"
                          onClick={() => openPosition(symbol)}
                          disabled={isOpen || !configuredCoin || opening || openingKey !== null}
                          title={
                            isOpen
                              ? 'Coin đang có vị thế mở'
                              : !configuredCoin
                                ? 'Cấu hình ký quỹ trước'
                                : 'Mở lệnh market'
                          }
                        >
                          {opening ? '…' : 'Open'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <SetupDialog
          symbol={editing}
          initial={configs[editing] ?? DEFAULT_CONFIG}
          onSave={(cfg) => {
            saveConfig(editing, cfg);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function SetupDialog({
  symbol,
  initial,
  onSave,
  onClose,
}: {
  symbol: string;
  initial: BitgetSetupConfig;
  onSave: (cfg: BitgetSetupConfig) => void;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [holdSide, setHoldSide] = useState<'long' | 'short'>(initial.holdSide);
  const [leverage, setLeverage] = useState(String(initial.leverage));
  const [marginUsd, setMarginUsd] = useState(initial.marginUsd > 0 ? String(initial.marginUsd) : '');

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

  if (!mounted) return null;

  return createPortal(
    <div className="bg-setup-overlay" onClick={onClose}>
      <div
        className="bg-setup-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Cấu hình ${symbol}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-setup-head">
          <h3>Cấu hình {symbol}</h3>
          <button type="button" className="bg-setup-x" onClick={onClose} aria-label="Đóng">
            ×
          </button>
        </div>

        <div className="bg-setup-body">
          <label className="bg-setup-field">
            <span>Hướng lệnh</span>
            <div className="bg-setup-side-toggle">
              <button
                type="button"
                className={`bg-setup-side ${holdSide === 'long' ? 'bg-setup-side--long' : ''}`}
                onClick={() => setHoldSide('long')}
              >
                LONG
              </button>
              <button
                type="button"
                className={`bg-setup-side ${holdSide === 'short' ? 'bg-setup-side--short' : ''}`}
                onClick={() => setHoldSide('short')}
              >
                SHORT
              </button>
            </div>
          </label>

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
            onClick={() => onSave({ holdSide, leverage: lev, marginUsd: margin })}
          >
            Lưu
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
