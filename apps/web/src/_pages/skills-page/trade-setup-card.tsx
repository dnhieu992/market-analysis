'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createApiClient } from '@web/shared/api/client';
import type { SkillTradeSetup } from '@web/shared/api/types';

const api = createApiClient();

const ORDER_LABEL: Record<SkillTradeSetup['orderType'], string> = {
  MARKET: 'Market (vào ngay)',
  LIMIT: 'Limit (chờ giá hồi)',
  STOP: 'Stop (chờ phá vỡ)',
};

/** Live state of the paper trade behind an accepted setup. */
const TRADE_STATUS: Record<string, { label: string; tone: 'info' | 'win' | 'loss' | 'muted' }> = {
  PENDING: { label: 'Đang chờ khớp', tone: 'info' },
  OPEN: { label: 'Đang mở', tone: 'info' },
  CLOSED_TP: { label: 'Chạm TP', tone: 'win' },
  CLOSED_SL: { label: 'Dính SL', tone: 'loss' },
  CLOSED_BE: { label: 'TP1 + hoà vốn', tone: 'win' },
  EXPIRED: { label: 'Hết hạn, không khớp', tone: 'muted' },
  CANCELLED: { label: 'Đã huỷ', tone: 'muted' },
};

function fmtPrice(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { maximumSignificantDigits: 7 });
}

function pct(from: number, to: number): string {
  const v = ((to - from) / from) * 100;
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

export function TradeSetupCard({ setup, onChange }: { setup: SkillTradeSetup; onChange: (s: SkillTradeSetup) => void }) {
  const [busy, setBusy] = useState<'accept' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const long = setup.direction === 'LONG';
  const risk = Math.abs(setup.entryPrice - setup.stopLoss);
  const rr = (tp: number) => (risk > 0 ? (Math.abs(tp - setup.entryPrice) / risk).toFixed(2) : '—');

  async function act(kind: 'accept' | 'cancel') {
    setBusy(kind);
    setError(null);
    try {
      const res = kind === 'accept' ? await api.acceptSkillSetup(setup.id) : await api.cancelSkillSetup(setup.id);
      onChange(res.setup);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Thao tác thất bại');
    } finally {
      setBusy(null);
    }
  }

  const tradeState = setup.trade ? TRADE_STATUS[setup.trade.status] : null;
  const canCancel = setup.status === 'PROPOSED' || setup.trade?.status === 'PENDING';

  return (
    <div className={`tsc tsc--${long ? 'long' : 'short'}`}>
      <div className="tsc-head">
        <span className={`tsc-dir tsc-dir--${long ? 'long' : 'short'}`}>{long ? 'LONG' : 'SHORT'}</span>
        <span className="tsc-symbol">{setup.symbol}</span>
        <span className="tsc-order">{ORDER_LABEL[setup.orderType]}</span>
        {setup.confidence && <span className="tsc-conf">Tin cậy: {setup.confidence}</span>}
      </div>
      {setup.setupType && <div className="tsc-type">{setup.setupType}</div>}

      <div className="tsc-grid">
        <div><span>Entry</span><b>{fmtPrice(setup.entryPrice)}</b></div>
        <div className="tsc-loss"><span>Stop loss</span><b>{fmtPrice(setup.stopLoss)}</b><small>{pct(setup.entryPrice, setup.stopLoss)}</small></div>
        <div className="tsc-win">
          <span>{setup.takeProfit2 != null ? 'TP1 (50%)' : 'Take profit'}</span>
          <b>{fmtPrice(setup.takeProfit1)}</b>
          <small>{pct(setup.entryPrice, setup.takeProfit1)} · R:R {rr(setup.takeProfit1)}</small>
        </div>
        {setup.takeProfit2 != null && (
          <div className="tsc-win"><span>TP2</span><b>{fmtPrice(setup.takeProfit2)}</b><small>{pct(setup.entryPrice, setup.takeProfit2)} · R:R {rr(setup.takeProfit2)}</small></div>
        )}
      </div>
      {setup.note && <div className="tsc-note">{setup.note}</div>}

      <div className="tsc-foot">
        {setup.status === 'PROPOSED' && (
          <button type="button" className="tsc-btn tsc-btn--accept" disabled={busy != null} onClick={() => { void act('accept'); }}>
            {busy === 'accept' ? 'Đang vào lệnh…' : '✓ Accept'}
          </button>
        )}
        {canCancel && (
          <button type="button" className="tsc-btn tsc-btn--cancel" disabled={busy != null} onClick={() => { void act('cancel'); }}>
            {busy === 'cancel' ? 'Đang huỷ…' : setup.status === 'PROPOSED' ? '✕ Cancel' : '✕ Huỷ lệnh chờ'}
          </button>
        )}
        {setup.status === 'CANCELLED' && !setup.trade && <span className="tsc-state tsc-state--muted">Đã huỷ</span>}
        {setup.trade && tradeState && (
          <span className={`tsc-state tsc-state--${tradeState.tone}`}>
            {tradeState.label}
            {setup.trade.status === 'OPEN' || setup.trade.status === 'PENDING' ? ` @ ${fmtPrice(setup.trade.entryPrice)}` : ''}
            {setup.trade.rMultiple != null ? ` · ${setup.trade.rMultiple >= 0 ? '+' : ''}${setup.trade.rMultiple.toFixed(2)}R` : ''}
          </span>
        )}
        {setup.trade && <Link href="/trading-analysis" className="tsc-link">Theo dõi ở Trading Analysis →</Link>}
      </div>
      {error && <div className="tsc-error">{error}</div>}
    </div>
  );
}
