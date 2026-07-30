'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import type { BitgetAutoTrade, BitgetSetupConfig } from '@web/shared/api/types';

type HoldSide = 'long' | 'short';

/** One side's saved (or newly entered) open config. */
export type SideConfigInput = { leverage: number; marginUsd: number };

/** What the dialog hands back on save — sides left blank come back as null. */
export type CoinSetupInput = {
  long: SideConfigInput | null;
  short: SideConfigInput | null;
  autoEnabled: boolean;
};

const DEFAULT_LEVERAGE = 10;

/** Draft state of one side's inputs — strings so a field can be empty. */
type SideDraft = { leverage: string; marginUsd: string };

function draftOf(cfg: BitgetSetupConfig | undefined): SideDraft {
  return {
    leverage: String(cfg?.leverage ?? DEFAULT_LEVERAGE),
    marginUsd: cfg && cfg.marginUsd > 0 ? String(cfg.marginUsd) : '',
  };
}

/** Parsed side, or null when it is left blank. `invalid` blocks the save. */
function parseSide(draft: SideDraft): { value: SideConfigInput | null; invalid: boolean } {
  const leverage = Number(draft.leverage);
  const marginUsd = Number(draft.marginUsd);
  if (draft.marginUsd.trim() === '') return { value: null, invalid: false };
  const ok =
    Number.isFinite(leverage) &&
    leverage >= 1 &&
    leverage <= 125 &&
    Number.isFinite(marginUsd) &&
    marginUsd > 0;
  return { value: ok ? { leverage, marginUsd } : null, invalid: !ok };
}

function fmtUsd(n: number): string {
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function fmtPrice(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 8;
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

/** Vietnamese label + colour class for a run's lifecycle state. */
const RUN_LABELS: Record<string, { text: string; cls: string }> = {
  open: { text: 'Đang mở, chờ 09:00 UTC', cls: 'bg-auto-run--open' },
  extended: { text: 'Gia hạn — TP đã dời về entry', cls: 'bg-auto-run--extended' },
  closed: { text: 'Đã đóng', cls: '' },
  skipped: { text: 'Bỏ qua', cls: '' },
  failed: { text: 'Lỗi', cls: 'bg-auto-run--failed' },
};

type Props = {
  symbol: string;
  /** Saved config of each side (undefined = never configured). */
  longConfig: BitgetSetupConfig | undefined;
  shortConfig: BitgetSetupConfig | undefined;
  /** Auto-entry switch + latest run for this coin (null = never armed). */
  auto: BitgetAutoTrade | null;
  saving: boolean;
  error: string | null;
  onSave: (input: CoinSetupInput) => void;
  onClose: () => void;
};

/**
 * One dialog per coin, replacing the two separate ⚙ (LONG / SHORT) buttons the
 * Setup table used to carry. It holds everything that is configured per coin:
 * the manual-open config of each side, and the "auto vào lệnh" switch that arms
 * the fixed 00:00 UTC LONG strategy (TP +2%, reviewed at 09:00 UTC).
 *
 * A side whose margin field is left empty stays UNCONFIGURED — the dialog never
 * writes a row for it, so "chưa cấu hình" keeps its meaning in the table.
 */
export function CoinSetupDialog({
  symbol,
  longConfig,
  shortConfig,
  auto,
  saving,
  error,
  onSave,
  onClose,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [long, setLong] = useState<SideDraft>(() => draftOf(longConfig));
  const [short, setShort] = useState<SideDraft>(() => draftOf(shortConfig));
  const [autoEnabled, setAutoEnabled] = useState(auto?.enabled ?? false);

  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const parsedLong = useMemo(() => parseSide(long), [long]);
  const parsedShort = useMemo(() => parseSide(short), [short]);
  const invalid = parsedLong.invalid || parsedShort.invalid;
  // Auto-entry sizes itself from the LONG config, so arming it without one would
  // only ever log a skip at 00:00 — block it in the UI, as the API does.
  const canArmAuto = parsedLong.value != null;
  const valid = !invalid && (!autoEnabled || canArmAuto);

  const run = auto?.latestRun ?? null;
  const runLabel = run ? (RUN_LABELS[run.status] ?? { text: run.status, cls: '' }) : null;

  const sideBlock = (holdSide: HoldSide, draft: SideDraft, setDraft: (next: SideDraft) => void) => {
    const isLong = holdSide === 'long';
    const parsed = isLong ? parsedLong : parsedShort;
    const notional = parsed.value ? parsed.value.leverage * parsed.value.marginUsd : null;
    return (
      <div className={`bg-bulk-side ${isLong ? 'bg-bulk-side--long' : 'bg-bulk-side--short'}`}>
        <div className="bg-bulk-side-head">
          <span className={`bg-side ${isLong ? 'bg-side--long' : 'bg-side--short'}`}>
            {isLong ? 'LONG' : 'SHORT'}
          </span>
        </div>
        <label className="bg-setup-field">
          <span>Đòn bẩy (×)</span>
          <input
            type="number"
            min={1}
            max={125}
            step={1}
            value={draft.leverage}
            onChange={(e) => setDraft({ ...draft, leverage: e.target.value })}
          />
        </label>
        <label className="bg-setup-field">
          <span>Ký quỹ (USDT)</span>
          <input
            type="number"
            min={0}
            step="any"
            value={draft.marginUsd}
            placeholder="để trống = chưa cấu hình"
            onChange={(e) => setDraft({ ...draft, marginUsd: e.target.value })}
          />
        </label>
        <p className="bg-setup-note">
          Giá trị lệnh ≈ <strong>{notional != null ? fmtUsd(notional) : '—'}</strong> · market · cross
        </p>
      </div>
    );
  };

  if (!mounted) return null;

  return createPortal(
    <div className="bg-setup-overlay" onClick={onClose}>
      <div
        className="bg-setup-dialog bg-setup-dialog--wide"
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
          <div className="bg-bulk-row">
            {sideBlock('long', long, setLong)}
            {sideBlock('short', short, setShort)}
          </div>
          {invalid && (
            <span className="bg-tpsl-hint bg-tpsl-hint--bad">
              Hướng đã nhập ký quỹ phải có đòn bẩy 1–125 và ký quỹ &gt; 0 (xoá trống ô ký quỹ nếu
              chưa muốn cấu hình hướng đó).
            </span>
          )}

          <div className="bg-auto-block">
            <label className="bg-auto-head">
              <input
                type="checkbox"
                checked={autoEnabled}
                disabled={!canArmAuto && !autoEnabled}
                onChange={(e) => setAutoEnabled(e.target.checked)}
              />
              <span className="bg-auto-title">Auto vào lệnh</span>
              <span className={`bg-auto-state ${autoEnabled ? 'bg-auto-state--on' : ''}`}>
                {autoEnabled ? 'BẬT' : 'TẮT'}
              </span>
            </label>

            <ul className="bg-auto-rules">
              <li>
                <strong>00:00 UTC</strong> mỗi ngày: vào <strong>LONG market</strong> theo cấu hình
                LONG ở trên (cross).
              </li>
              <li>
                Đặt <strong>TP +2%</strong> ngay trên sàn — 2% <em>giá</em>, chưa tính đòn bẩy (đòn
                bẩy {parsedLong.value?.leverage ?? DEFAULT_LEVERAGE}× ⇒ ~
                {((parsedLong.value?.leverage ?? DEFAULT_LEVERAGE) * 2).toFixed(0)}% ROE).
              </li>
              <li>
                <strong>09:00 UTC</strong>: đang lãi, hoà, hoặc âm không quá{' '}
                <strong>0,5%</strong> → <strong>chốt bắt buộc</strong> theo giá market.
              </li>
              <li>
                Âm <strong>quá 0,5%</strong> → giữ lệnh chạy tiếp, <strong>dời TP về đúng giá
                entry</strong> (thoát hoà vốn, trừ phí).
              </li>
              <li className="bg-auto-rule-muted">
                Không đặt stop-loss. Coin đang có lệnh LONG mở lúc 00:00 (lệnh gia hạn hôm trước
                hoặc lệnh vào tay) sẽ bị <strong>bỏ qua ngày đó</strong>, bot không cộng volume và
                không đóng lệnh đó lúc 09:00.
              </li>
            </ul>

            {!canArmAuto && (
              <span className="bg-tpsl-hint bg-tpsl-hint--bad">
                Nhập ký quỹ LONG trước thì mới bật được auto — bot lấy đòn bẩy/ký quỹ từ cấu hình
                LONG.
              </span>
            )}

            {run && runLabel && (
              <div className="bg-auto-run">
                <span className="bg-auto-run-date">{run.tradeDate}</span>
                <span className={`bg-auto-run-status ${runLabel.cls}`}>{runLabel.text}</span>
                {run.entryPrice != null && (
                  <span className="bg-auto-run-num">entry {fmtPrice(run.entryPrice)}</span>
                )}
                {run.tpPrice != null && (
                  <span className="bg-auto-run-num">TP {fmtPrice(run.tpPrice)}</span>
                )}
                {run.detail && <p className="bg-auto-run-detail">{run.detail}</p>}
              </div>
            )}
          </div>

          {error && <span className="bg-tpsl-hint bg-tpsl-hint--bad">{error}</span>}
        </div>

        <div className="bg-setup-foot">
          <button type="button" className="bg-setup-cancel" onClick={onClose} disabled={saving}>
            Huỷ
          </button>
          <button
            type="button"
            className="bg-setup-save"
            disabled={!valid || saving}
            onClick={() =>
              onSave({ long: parsedLong.value, short: parsedShort.value, autoEnabled })
            }
          >
            {saving ? 'Đang lưu…' : 'Lưu'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
