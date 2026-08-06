'use client';

import type { AssetDeployedSource, AssetDeployedValue } from '@web/shared/api/types';

function formatUsdt(value: number): string {
  return `${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)} USDT`;
}

function formatSigned(value: number): string {
  return `${value >= 0 ? '+' : '−'}${formatUsdt(Math.abs(value))}`;
}

function formatPct(value: number): string {
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}%`;
}

/**
 * Every source is named, not just the degraded ones — a trader comparing this
 * against /bitget or /trades needs to know which number they are looking at
 * before they go hunting for a discrepancy that isn't one.
 */
const SOURCE_LABEL: Record<AssetDeployedSource, string> = {
  exchange: 'Số dư live trên sàn',
  sync: 'Lệnh đã đóng đã đồng bộ — chưa tính lệnh đang mở',
  orders: 'Sổ lệnh /trades — đã chốt + đang mở theo giá hiện tại',
  unknown: 'Không đọc được PnL — chỉ hiện vốn',
};

export type DeployedTotals = {
  capitalUsdt: number;
  currentValueUsdt: number;
  /** Null when not a single bucket could be valued — there is no total to state. */
  pnlUsdt: number | null;
  pnlPct: number | null;
};

/**
 * Roll the buckets into one line. Buckets whose PnL is unknown still contribute
 * their capital (the money is real and committed) but nothing to the PnL, so the
 * percentage stays a return on the capital that was actually measurable —
 * mixing unmeasured capital into the denominator would understate the result.
 */
export function summarizeDeployed(buckets: AssetDeployedValue[]): DeployedTotals {
  const capitalUsdt = buckets.reduce((sum, b) => sum + b.capitalUsdt, 0);
  const currentValueUsdt = buckets.reduce((sum, b) => sum + b.currentValueUsdt, 0);

  const valued = buckets.filter((b) => b.pnlUsdt != null);
  if (valued.length === 0) {
    return { capitalUsdt, currentValueUsdt, pnlUsdt: null, pnlPct: null };
  }

  const pnlUsdt = valued.reduce((sum, b) => sum + (b.pnlUsdt ?? 0), 0);
  const valuedCapital = valued.reduce((sum, b) => sum + b.capitalUsdt, 0);

  return {
    capitalUsdt,
    currentValueUsdt,
    pnlUsdt,
    pnlPct: valuedCapital > 0 ? (pnlUsdt / valuedCapital) * 100 : null,
  };
}

type Props = Readonly<{
  buckets: AssetDeployedValue[];
}>;

/**
 * The deployed accounts — Bitget, MEXC and the manual trade book — shown as
 * capital vs. what that capital is worth now. Showing only the amount
 * transferred in hides the entire question the page exists to answer.
 */
export function DeployedBuckets({ buckets }: Props) {
  if (buckets.length === 0) {
    return <p className="ma-empty">Chưa có danh mục nào đang triển khai vốn.</p>;
  }

  const totals = summarizeDeployed(buckets);

  return (
    <div className="ma-table-wrap">
      <table className="ma-table ma-deployed">
        <thead>
          <tr>
            <th>Danh mục</th>
            <th className="ma-num">Vốn</th>
            <th className="ma-num">Giá trị hiện tại</th>
            <th className="ma-num">Lãi/lỗ</th>
            <th className="ma-num">%</th>
            <th>Nguồn</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((bucket) => {
            const negative = (bucket.pnlUsdt ?? 0) < 0;
            return (
              <tr key={bucket.key}>
                <td>
                  <strong>{bucket.label}</strong>
                </td>
                <td className="ma-num">{formatUsdt(bucket.capitalUsdt)}</td>
                <td className="ma-num">{formatUsdt(bucket.currentValueUsdt)}</td>
                {/* An unknown PnL prints an em dash rather than 0 — "we don't know"
                    and "it broke even" are different answers. */}
                <td className={`ma-num${negative ? ' is-negative' : ''}`}>
                  {bucket.pnlUsdt == null ? '—' : formatSigned(bucket.pnlUsdt)}
                </td>
                <td className={`ma-num${negative ? ' is-negative' : ''}`}>
                  {bucket.pnlPct == null ? '—' : formatPct(bucket.pnlPct)}
                </td>
                <td className="ma-src">
                  {SOURCE_LABEL[bucket.source]}
                  {bucket.pricedPartially ? ' · một số lệnh chưa có giá' : ''}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td>
              <strong>Tổng</strong>
            </td>
            <td className="ma-num">{formatUsdt(totals.capitalUsdt)}</td>
            <td className="ma-num">{formatUsdt(totals.currentValueUsdt)}</td>
            <td className={`ma-num${(totals.pnlUsdt ?? 0) < 0 ? ' is-negative' : ''}`}>
              {totals.pnlUsdt == null ? '—' : formatSigned(totals.pnlUsdt)}
            </td>
            <td className={`ma-num${(totals.pnlUsdt ?? 0) < 0 ? ' is-negative' : ''}`}>
              {totals.pnlPct == null ? '—' : formatPct(totals.pnlPct)}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
