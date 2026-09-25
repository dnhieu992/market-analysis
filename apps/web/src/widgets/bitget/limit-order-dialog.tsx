'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

/** Limit-price preset marks — % offset from the current price. */
const PRICE_PCT_MARKS = [1, 2, 3, 5, 7, 10];

function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(3);
  if (n >= 0.01) return n.toFixed(5);
  return n.toPrecision(3);
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Round a computed price to a sensible precision for the number input. */
function roundPrice(n: number): number {
  if (n >= 1000) return Math.round(n * 100) / 100;
  if (n >= 1) return Math.round(n * 1000) / 1000;
  if (n >= 0.01) return Math.round(n * 1e5) / 1e5;
  return Number(n.toPrecision(4));
}

function parseNum(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

type Props = {
  symbol: string;
  holdSide: 'long' | 'short';
  /** Live price used to prefill the field and compute the % marks; null while loading. */
  currentPrice: number | null;
  /** Prefilled from the coin+side saved config (0 = unconfigured). */
  initialLeverage: number;
  initialMarginUsd: number;
  saving: boolean;
  error: string | null;
  onPlace: (input: { leverage: number; marginUsd: number; price: number }) => void;
  onClose: () => void;
};

/**
 * Place a resting LIMIT entry for one coin+side from the Setup tab. Same
 * margin/leverage inputs as a market open, plus a limit price with quick-pick %
 * marks measured off the live price (LONG buys below, SHORT sells above). The
 * order rests on Bitget until the price is reached, then fills into a position.
 */
export function LimitOrderDialog({
  symbol,
  holdSide,
  currentPrice,
  initialLeverage,
  initialMarginUsd,
  saving,
  error,
  onPlace,
  onClose,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const isLong = holdSide === 'long';
  const [leverage, setLeverage] = useState(initialLeverage > 0 ? String(initialLeverage) : '10');
  const [marginUsd, setMarginUsd] = useState(initialMarginUsd > 0 ? String(initialMarginUsd) : '');
  const [price, setPrice] = useState(currentPrice ? String(roundPrice(currentPrice)) : '');
  // Which preset % is applied to the price (for highlighting). Cleared on manual edit.
  const [pricePct, setPricePct] = useState<number | null>(null);

  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // A mark = a % move off the CURRENT price: LONG buys lower (−%), SHORT sells
  // higher (+%). The resulting price is where the resting order waits to fill.
  const applyPricePct = (pct: number) => {
    if (!currentPrice) return;
    const target = currentPrice * (1 + (isLong ? -1 : 1) * (pct / 100));
    setPrice(String(roundPrice(target)));
    setPricePct(pct);
  };

  const levValue = parseNum(leverage);
  const marginValue = parseNum(marginUsd);
  const priceValue = parseNum(price);

  const levOk = levValue != null && Number.isFinite(levValue) && levValue >= 1 && levValue <= 125;
  const marginOk = marginValue != null && Number.isFinite(marginValue) && marginValue > 0;
  const priceOk = priceValue != null && Number.isFinite(priceValue) && priceValue > 0;
  const valid = levOk && marginOk && priceOk;

  // A limit on the "wrong" side of the market fills immediately like a market
  // order (LONG above price, SHORT below). Allowed by Bitget — just flag it.
  const fillsNow =
    priceOk && currentPrice != null
      ? isLong
        ? (priceValue as number) >= currentPrice
        : (priceValue as number) <= currentPrice
      : false;

  const estNotional = useMemo(
    () => (levOk && marginOk ? (levValue as number) * (marginValue as number) : null),
    [levOk, marginOk, levValue, marginValue],
  );
  const estSize = useMemo(
    () => (estNotional != null && priceOk ? estNotional / (priceValue as number) : null),
    [estNotional, priceOk, priceValue],
  );

  if (!mounted) return null;

  return createPortal(
    <div className="bg-setup-overlay" onClick={onClose}>
      <div
        className="bg-setup-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Đặt lệnh limit ${symbol}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-setup-head">
          <h3>
            Lệnh limit {symbol}{' '}
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
              Giá hiện tại: <strong>{fmtPrice(currentPrice)}</strong>
            </span>
            <span>
              Hướng: <strong>{isLong ? 'Mua thấp hơn' : 'Bán cao hơn'}</strong>
            </span>
          </div>

          <div className="bg-limit-row">
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
              <span>Ký quỹ (USDT)</span>
              <input
                type="number"
                min={0}
                step="any"
                value={marginUsd}
                placeholder="ví dụ 30"
                onChange={(e) => setMarginUsd(e.target.value)}
              />
            </label>
          </div>

          <label className="bg-setup-field">
            <span>Giá limit (giá chờ khớp)</span>
            <input
              type="number"
              min={0}
              step="any"
              value={price}
              placeholder={isLong ? 'thấp hơn giá hiện tại' : 'cao hơn giá hiện tại'}
              onChange={(e) => {
                setPrice(e.target.value);
                setPricePct(null);
              }}
            />
            <div className="bg-tpsl-marks" role="group" aria-label="Chọn nhanh % lệch so với giá hiện tại">
              {PRICE_PCT_MARKS.map((pct) => (
                <button
                  key={pct}
                  type="button"
                  className={`bg-tpsl-mark${pricePct === pct ? ' bg-tpsl-mark--on' : ''}`}
                  onClick={() => applyPricePct(pct)}
                  disabled={!currentPrice}
                >
                  {isLong ? '−' : '+'}
                  {pct}%
                </button>
              ))}
            </div>
            <span className="bg-tpsl-hint bg-tpsl-hint--muted">
              % lệch so với giá hiện tại ({fmtPrice(currentPrice)}) — {isLong ? 'LONG mua thấp hơn' : 'SHORT bán cao hơn'}.
            </span>
            {fillsNow && (
              <span className="bg-tpsl-hint bg-tpsl-hint--bad">
                Giá này {isLong ? 'cao hơn' : 'thấp hơn'} giá hiện tại → lệnh có thể khớp ngay như lệnh market.
              </span>
            )}
          </label>

          <p className="bg-setup-note">
            Ước tính: size ≈ <strong>{estSize != null ? estSize.toLocaleString('en-US', { maximumFractionDigits: 6 }) : '—'}</strong>{' '}
            · giá trị ≈ <strong>{fmtUsd(estNotional)}</strong> · cross. Lệnh được đẩy thẳng lên{' '}
            <strong>Bitget</strong> ở dạng lệnh chờ — sàn tự mở vị thế khi giá chạm mức, không phụ thuộc
            dashboard này.
          </p>

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
              onPlace({
                leverage: levValue as number,
                marginUsd: marginValue as number,
                price: priceValue as number,
              })
            }
          >
            {saving ? 'Đang đặt…' : 'Đặt lệnh chờ'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
