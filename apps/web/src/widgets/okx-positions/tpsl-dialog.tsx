'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import type { OkxPosition } from '@web/shared/api/types';

function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(3);
  if (n >= 0.01) return n.toFixed(5);
  return n.toPrecision(3);
}

function fmtSigned(n: number): string {
  return `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}`;
}

/** Empty input = clear the trigger; anything unparseable is rejected by `valid`. */
function parsePrice(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

type Props = {
  position: OkxPosition;
  saving: boolean;
  onSave: (input: { takeProfitPrice: number | null; stopLossPrice: number | null }) => void;
  onClose: () => void;
};

/**
 * Set the exchange-side TP/SL of one open position. The values are pushed to
 * OKX as position-level TP/SL orders, so the EXCHANGE closes the position when
 * a trigger is hit — this dashboard does not have to be running. Leaving a field
 * empty clears that trigger.
 */
export function TpslDialog({ position: p, saving, onSave, onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  // No TP set yet → prefill with the current mark price so the level can be
  // nudged from where the market is instead of typed from scratch.
  const [tp, setTp] = useState(String(p.takeProfitPrice ?? p.markPrice));
  const [sl, setSl] = useState(p.stopLossPrice != null ? String(p.stopLossPrice) : '');

  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isLong = p.holdSide === 'long';
  const tpValue = parsePrice(tp);
  const slValue = parsePrice(sl);

  // Projected PnL / ROE if the trigger fires, so the levels can be judged in
  // money rather than price alone (fees excluded — this is the gross move).
  const project = (target: number | null) => {
    if (target == null || !Number.isFinite(target)) return null;
    const pnl = (target - p.entryPrice) * p.size * (isLong ? 1 : -1);
    return { pnl, roe: p.marginUsd > 0 ? (pnl / p.marginUsd) * 100 : 0 };
  };
  const tpProj = useMemo(() => project(tpValue), [tpValue]);
  const slProj = useMemo(() => project(slValue), [slValue]);

  const badNumber = Number.isNaN(tpValue as number) || Number.isNaN(slValue as number);
  const tpWrongSide =
    tpValue != null && Number.isFinite(tpValue) && (isLong ? tpValue <= p.markPrice : tpValue >= p.markPrice);
  const slWrongSide =
    slValue != null && Number.isFinite(slValue) && (isLong ? slValue >= p.markPrice : slValue <= p.markPrice);
  const valid = !badNumber && !tpWrongSide && !slWrongSide;

  if (!mounted) return null;

  return createPortal(
    <div className="bg-setup-overlay" onClick={onClose}>
      <div
        className="bg-setup-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Đặt TP/SL ${p.symbol}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-setup-head">
          <h3>
            TP / SL {p.symbol}{' '}
            <span className={`bg-side ${isLong ? 'bg-side--long' : 'bg-side--short'}`}>
              {isLong ? 'LONG' : 'SHORT'}
            </span>
          </h3>
          <button type="button" className="bg-setup-x" onClick={onClose} aria-label="Đóng">
            ×
          </button>
        </div>

        <div className="bg-setup-body">
          <div className="bg-tpsl-meta">
            <span>
              Giá vào: <strong>{fmtPrice(p.entryPrice)}</strong>
            </span>
            <span>
              Giá hiện tại: <strong>{fmtPrice(p.markPrice)}</strong>
            </span>
            <span>
              Size: <strong>{p.size.toLocaleString('en-US', { maximumFractionDigits: 6 })}</strong>
            </span>
          </div>

          <label className="bg-setup-field">
            <span>Take Profit (giá kích hoạt)</span>
            <input
              type="number"
              min={0}
              step="any"
              value={tp}
              placeholder={isLong ? 'cao hơn giá hiện tại' : 'thấp hơn giá hiện tại'}
              onChange={(e) => setTp(e.target.value)}
            />
            {tpWrongSide ? (
              <span className="bg-tpsl-hint bg-tpsl-hint--bad">
                TP phải {isLong ? 'cao hơn' : 'thấp hơn'} giá hiện tại ({fmtPrice(p.markPrice)}).
              </span>
            ) : tpProj ? (
              <span className="bg-tpsl-hint bg-tpsl-hint--tp">
                Nếu chạm: {fmtSigned(tpProj.pnl)} USDT · ROE {fmtSigned(tpProj.roe)}%
              </span>
            ) : null}
          </label>

          <label className="bg-setup-field">
            <span>Stop Loss (giá kích hoạt)</span>
            <input
              type="number"
              min={0}
              step="any"
              value={sl}
              placeholder={isLong ? 'thấp hơn giá hiện tại' : 'cao hơn giá hiện tại'}
              onChange={(e) => setSl(e.target.value)}
            />
            {slWrongSide ? (
              <span className="bg-tpsl-hint bg-tpsl-hint--bad">
                SL phải {isLong ? 'thấp hơn' : 'cao hơn'} giá hiện tại ({fmtPrice(p.markPrice)}).
              </span>
            ) : slProj ? (
              <span className="bg-tpsl-hint bg-tpsl-hint--sl">
                Nếu chạm: {fmtSigned(slProj.pnl)} USDT · ROE {fmtSigned(slProj.roe)}%
              </span>
            ) : null}
          </label>

          <p className="bg-setup-note">
            Lệnh TP/SL được đẩy thẳng lên <strong>OKX</strong> (kích hoạt theo Mark Price, đóng
            toàn bộ vị thế) — sàn tự đóng khi chạm mức, không phụ thuộc vào dashboard này. Để trống
            một ô để <strong>xoá</strong> mức đó trên sàn.
          </p>
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
              onSave({
                takeProfitPrice: tpValue as number | null,
                stopLossPrice: slValue as number | null,
              })
            }
          >
            {saving ? 'Đang lưu…' : 'Lưu lên sàn'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
