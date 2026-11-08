'use client';

import type { SkillTradeSetup } from '@web/shared/api/types';

const ORDER_LABEL: Record<SkillTradeSetup['orderType'], string> = {
  MARKET: 'Market (vào ngay)',
  LIMIT: 'Limit (chờ giá hồi)',
  STOP: 'Stop (chờ phá vỡ)',
};

function fmtPrice(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { maximumSignificantDigits: 7 });
}

function pct(from: number, to: number): string {
  const v = ((to - from) / from) * 100;
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

/** Read-only card for a setup the scalping chat proposed. */
export function TradeSetupCard({ setup }: { setup: SkillTradeSetup }) {
  const long = setup.direction === 'LONG';
  const risk = Math.abs(setup.entryPrice - setup.stopLoss);
  const rr = (tp: number) => (risk > 0 ? (Math.abs(tp - setup.entryPrice) / risk).toFixed(2) : '—');

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
    </div>
  );
}
