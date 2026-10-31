'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import type { TradingExchange } from '@web/shared/api/types';
import { EXCHANGES, EXCHANGE_LABEL, EXCHANGE_SHORT } from './exchanges';

import styles from './trading-list.module.css';

type HoldSide = 'long' | 'short';
type SideConfig = { leverage: number; marginUsd: number };

/** What the dialog hands back on save — sides left blank come back as null. */
export type ExchangeConfigInput = Record<TradingExchange, Record<HoldSide, SideConfig | null>>;

const DEFAULT_LEVERAGE = 10;

/** Draft state of one side's inputs — strings so a field can be empty. */
type SideDraft = { leverage: string; marginUsd: string };
type Drafts = Record<TradingExchange, Record<HoldSide, SideDraft>>;

function draftOf(cfg: SideConfig | undefined): SideDraft {
  return {
    leverage: String(cfg?.leverage ?? DEFAULT_LEVERAGE),
    marginUsd: cfg && cfg.marginUsd > 0 ? String(cfg.marginUsd) : '',
  };
}

/** Parsed side, or null when it is left blank. `invalid` blocks the save. */
function parseSide(draft: SideDraft): { value: SideConfig | null; invalid: boolean } {
  if (draft.marginUsd.trim() === '') return { value: null, invalid: false };
  const leverage = Number(draft.leverage);
  const marginUsd = Number(draft.marginUsd);
  const ok = Number.isFinite(leverage) && leverage >= 1 && leverage <= 125 && Number.isFinite(marginUsd) && marginUsd > 0;
  return { value: ok ? { leverage, marginUsd } : null, invalid: !ok };
}

function fmtUsd(n: number): string {
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

type Props = {
  symbol: string;
  configs: Record<TradingExchange, Record<HoldSide, SideConfig | undefined>>;
  saving: boolean;
  error: string | null;
  onSave: (input: ExchangeConfigInput) => void;
  onClose: () => void;
};

/**
 * ⚙ dialog of /trading-list: LONG + SHORT leverage/margin for one coin on both
 * Bitget and MEXC. Each exchange keeps its own config (the same rows /bitget and
 * /mexc read); Bitget's auto-entry switch stays on /bitget.
 */
export function ExchangeConfigDialog({ symbol, configs, saving, error, onSave, onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  const [drafts, setDrafts] = useState<Drafts>(() => ({
    bitget: { long: draftOf(configs.bitget.long), short: draftOf(configs.bitget.short) },
    mexc: { long: draftOf(configs.mexc.long), short: draftOf(configs.mexc.short) },
  }));

  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const parsed = useMemo(() => {
    const out = {} as Record<TradingExchange, Record<HoldSide, ReturnType<typeof parseSide>>>;
    for (const ex of EXCHANGES) out[ex] = { long: parseSide(drafts[ex].long), short: parseSide(drafts[ex].short) };
    return out;
  }, [drafts]);
  const invalid = EXCHANGES.some((ex) => parsed[ex].long.invalid || parsed[ex].short.invalid);

  const setDraft = (ex: TradingExchange, holdSide: HoldSide, next: SideDraft) =>
    setDrafts((prev) => ({ ...prev, [ex]: { ...prev[ex], [holdSide]: next } }));

  const sideBlock = (ex: TradingExchange, holdSide: HoldSide) => {
    const isLong = holdSide === 'long';
    const draft = drafts[ex][holdSide];
    const value = parsed[ex][holdSide].value;
    return (
      <div key={holdSide} className={`bg-bulk-side ${isLong ? 'bg-bulk-side--long' : 'bg-bulk-side--short'}`}>
        <div className="bg-bulk-side-head">
          <span className={`bg-side ${isLong ? 'bg-side--long' : 'bg-side--short'}`}>{isLong ? 'LONG' : 'SHORT'}</span>
        </div>
        <label className="bg-setup-field">
          <span>Đòn bẩy (×)</span>
          <input
            type="number"
            min={1}
            max={125}
            step={1}
            value={draft.leverage}
            onChange={(e) => setDraft(ex, holdSide, { ...draft, leverage: e.target.value })}
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
            onChange={(e) => setDraft(ex, holdSide, { ...draft, marginUsd: e.target.value })}
          />
        </label>
        <p className="bg-setup-note">
          Giá trị lệnh ≈ <strong>{value ? fmtUsd(value.leverage * value.marginUsd) : '—'}</strong> · cross
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
          {EXCHANGES.map((ex) => (
            <section key={ex} className={styles.cfgSection}>
              <div className={styles.cfgSectionHead}>
                <span className={`${styles.exTag} ${styles[`ex_${ex}`]}`}>{EXCHANGE_SHORT[ex]}</span>
                <strong>{EXCHANGE_LABEL[ex]}</strong>
              </div>
              <div className="bg-bulk-row">{(['long', 'short'] as const).map((side) => sideBlock(ex, side))}</div>
            </section>
          ))}
          {invalid && (
            <span className="bg-tpsl-hint bg-tpsl-hint--bad">
              Hướng đã nhập ký quỹ phải có đòn bẩy 1–125 và ký quỹ &gt; 0 (xoá trống ô ký quỹ nếu chưa muốn cấu hình hướng đó).
            </span>
          )}
          <p className="bg-setup-note">Cấu hình này dùng chung với tab Setup của /bitget và /mexc. Auto vào lệnh (Bitget) chỉnh ở /bitget.</p>
          {error && <span className="bg-tpsl-hint bg-tpsl-hint--bad">{error}</span>}
        </div>

        <div className="bg-setup-foot">
          <button type="button" className="bg-setup-cancel" onClick={onClose} disabled={saving}>
            Huỷ
          </button>
          <button
            type="button"
            className="bg-setup-save"
            disabled={invalid || saving}
            onClick={() =>
              onSave({
                bitget: { long: parsed.bitget.long.value, short: parsed.bitget.short.value },
                mexc: { long: parsed.mexc.long.value, short: parsed.mexc.short.value },
              })
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
