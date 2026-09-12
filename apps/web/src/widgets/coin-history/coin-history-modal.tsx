'use client';

import { useMemo } from 'react';
import { createPortal } from 'react-dom';

import { formatCryptoPrice } from '@web/shared/lib/format';
import type { CoinTransaction } from '@web/shared/api/types';

/** One full buy→sell-to-zero round trip for a coin, built from its raw transaction ledger. */
export type Cycle = {
  startAt: string;
  endAt: string | null; // null = position still open (not fully sold)
  avgBuyPrice: number;
  avgSellPrice: number | null;
  totalBuyAmount: number;
  totalSellAmount: number;
  investedUsdt: number; // total USDT put into buys this cycle
  pnl: number | null; // null while the cycle is still open
};

const ZERO_EPSILON = 1e-8;

export function buildCyclesForCoin(transactions: CoinTransaction[]): Cycle[] {
  const sorted = [...transactions]
    .filter((tx) => !tx.deletedAt)
    .sort((a, b) => new Date(a.transactedAt).getTime() - new Date(b.transactedAt).getTime());

  const cycles: Cycle[] = [];
  let amount = 0;
  let startAt: string | null = null;
  let buyAmount = 0, buyValue = 0, buyFee = 0;
  let sellAmount = 0, sellValue = 0, sellFee = 0;

  const reset = () => {
    amount = 0;
    startAt = null;
    buyAmount = 0; buyValue = 0; buyFee = 0;
    sellAmount = 0; sellValue = 0; sellFee = 0;
  };

  for (const tx of sorted) {
    if (startAt === null && tx.type === 'buy') startAt = tx.transactedAt;
    if (tx.type === 'buy') {
      amount += tx.amount;
      buyAmount += tx.amount;
      buyValue += tx.totalValue;
      buyFee += tx.fee;
    } else {
      amount -= tx.amount;
      sellAmount += tx.amount;
      sellValue += tx.totalValue;
      sellFee += tx.fee;
    }

    if (startAt !== null && amount <= ZERO_EPSILON) {
      cycles.push({
        startAt,
        endAt: tx.transactedAt,
        avgBuyPrice: buyAmount > 0 ? buyValue / buyAmount : 0,
        avgSellPrice: sellAmount > 0 ? sellValue / sellAmount : null,
        totalBuyAmount: buyAmount,
        totalSellAmount: sellAmount,
        investedUsdt: buyValue,
        pnl: sellValue - buyValue - buyFee - sellFee,
      });
      reset();
    }
  }

  // Still holding — the current, not-yet-closed cycle.
  if (startAt !== null && amount > ZERO_EPSILON) {
    cycles.push({
      startAt,
      endAt: null,
      avgBuyPrice: buyAmount > 0 ? buyValue / buyAmount : 0,
      avgSellPrice: sellAmount > 0 ? sellValue / sellAmount : null,
      totalBuyAmount: buyAmount,
      totalSellAmount: sellAmount,
      investedUsdt: buyValue,
      pnl: null,
    });
  }

  return cycles.reverse();
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

function PnlCell({ value }: { value: number }) {
  const isPositive = value >= 0;
  return (
    <div className={isPositive ? 'tt-pnl-positive' : 'tt-pnl-negative'}>
      {isPositive ? '+' : ''}{formatUsd(value)}
    </div>
  );
}

/**
 * Dialog listing every buy→sell-to-zero cycle a coin has been through ("chu kì đã đầu tư").
 * Shared by the portfolio holdings list and the coin detail page so both read identically.
 */
export function CoinHistoryModal({ coinId, transactions, onClose }: {
  coinId: string;
  transactions: CoinTransaction[];
  onClose: () => void;
}) {
  const cycles = useMemo(
    () => buildCyclesForCoin(transactions.filter((tx) => tx.coinId === coinId)),
    [transactions, coinId],
  );

  return createPortal(
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog dialog--wide" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-title">History — {coinId}</span>
          <button className="dialog-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="dialog-body">
          {cycles.length === 0 ? (
            <p className="tt-muted">Chưa có giao dịch nào cho {coinId}.</p>
          ) : (
            <div className="tt-wrap tt-card-wrap">
              <table className="tt tt-card">
                <thead>
                  <tr>
                    <th>Bắt đầu mua</th>
                    <th>Bán hết lúc</th>
                    <th>Giá mua TB</th>
                    <th>Giá bán TB</th>
                    <th>Đã đầu tư (USDT)</th>
                    <th>P/L (USDT)</th>
                  </tr>
                </thead>
                <tbody>
                  {cycles.map((c, i) => (
                    <tr key={i}>
                      <td data-label="Bắt đầu mua">{formatDateTime(c.startAt)}</td>
                      <td data-label="Bán hết lúc">
                        {c.endAt ? formatDateTime(c.endAt) : <span className="tt-muted">Đang mở</span>}
                      </td>
                      <td data-label="Giá mua TB">{formatCryptoPrice(c.avgBuyPrice)}</td>
                      <td data-label="Giá bán TB">
                        {c.avgSellPrice != null ? formatCryptoPrice(c.avgSellPrice) : <span className="tt-muted">—</span>}
                      </td>
                      <td data-label="Đã đầu tư (USDT)">{formatUsd(c.investedUsdt)}</td>
                      <td data-label="P/L (USDT)">
                        {c.pnl != null ? <PnlCell value={c.pnl} /> : <span className="tt-muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
