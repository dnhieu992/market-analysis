import type { FillAction, FillExchange, FillSide, OrderMeta, PositionSnap, RawFill } from './order-fill.types';

/** Position phase after the order, when the live positions could be read. */
export type FillPhase = 'new' | 'dca' | 'partial_close' | 'full_close' | null;

/** All fills of ONE order, aggregated. */
export type OrderFillSummary = {
  exchange: FillExchange;
  orderId: string;
  symbol: string;
  side: FillSide | null;
  action: FillAction;
  phase: FillPhase;
  kind: OrderMeta['kind'];
  orderType: string | null;
  size: number;
  quote: number;
  avgPrice: number;
  profit: number;
  fee: number;
  fillCount: number;
  firstTs: number;
  lastTs: number;
  /** The position on the same symbol + side after the fills (null = flat or unknown). */
  position: PositionSnap | null;
};

export const EXCHANGE_LABEL: Record<FillExchange, string> = { bitget: 'Bitget', mexc: 'MEXC' };
export const EXCHANGE_SHORT: Record<FillExchange, string> = { bitget: 'BG', mexc: 'MX' };

/** Group fills by order id, each group sorted by time, duplicate fill ids dropped. */
export function groupFillsByOrder(fills: RawFill[]): Map<string, RawFill[]> {
  const seen = new Set<string>();
  const groups = new Map<string, RawFill[]>();
  for (const f of [...fills].sort((a, b) => a.ts - b.ts)) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    const list = groups.get(f.orderId) ?? [];
    list.push(f);
    groups.set(f.orderId, list);
  }
  return groups;
}

/**
 * Aggregate an order's fills. `positions` = live positions read after the fills (null when
 * that lookup failed → phase unknown).
 */
export function summarizeOrderFills(
  exchange: FillExchange,
  fills: RawFill[],
  meta: OrderMeta | null,
  positions: PositionSnap[] | null,
): OrderFillSummary {
  const first = fills[0];
  if (!first) throw new Error('summarizeOrderFills: no fills');
  const last = fills[fills.length - 1] ?? first;
  const size = fills.reduce((s, f) => s + f.size, 0);
  const quote = fills.reduce((s, f) => s + f.quote, 0);
  const action: FillAction = meta?.kind === 'liquidation' ? 'liquidation' : first.action;
  const position =
    first.side && positions
      ? (positions.find((p) => p.symbol === first.symbol && p.side === first.side && p.size > 0) ?? null)
      : null;

  let phase: FillPhase = null;
  if (positions && first.side) {
    if (action === 'open') {
      if (position) phase = Math.abs(position.size - size) <= Math.max(size * 0.01, 1e-12) ? 'new' : 'dca';
    } else if (action === 'close' || action === 'liquidation') {
      phase = position ? 'partial_close' : 'full_close';
    }
  }

  return {
    exchange,
    orderId: first.orderId,
    symbol: first.symbol,
    side: first.side,
    action,
    phase,
    kind: meta?.kind ?? null,
    orderType: meta?.orderType ?? null,
    size,
    quote,
    avgPrice: size > 0 ? quote / size : first.price,
    profit: fills.reduce((s, f) => s + f.profit, 0),
    fee: fills.reduce((s, f) => s + f.fee, 0),
    fillCount: fills.length,
    firstTs: first.ts,
    lastTs: last.ts,
    position,
  };
}

export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (Math.abs(n) >= 1) return String(Number(n.toFixed(4)));
  return String(Number(n.toPrecision(4)));
}

function fmtSigned(n: number, digits = 2): string {
  return `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(digits)}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function phaseLabel(s: OrderFillSummary): string {
  if (s.action === 'liquidation') return s.phase === 'partial_close' ? 'Thanh lý 1 phần' : 'Thanh lý';
  switch (s.phase) {
    case 'new':
      return 'Mở mới';
    case 'dca':
      return 'DCA';
    case 'partial_close':
      return 'Đóng 1 phần';
    case 'full_close':
      return 'Đóng hết';
    default:
      return s.action === 'open' ? 'Vào lệnh' : s.action === 'close' ? 'Đóng lệnh' : 'Khớp lệnh';
  }
}

function tags(s: OrderFillSummary): string[] {
  const out: string[] = [];
  if (s.kind === 'tp') out.push('TP');
  if (s.kind === 'sl') out.push('SL');
  if (s.orderType) out.push(s.orderType.charAt(0).toUpperCase() + s.orderType.slice(1));
  return out;
}

export type FormattedNotification = { title: string; body: string; telegram: string };

/** App title/body + Telegram (HTML) text of one order fill. `revision` > 1 = the order filled more since last time. */
export function formatOrderFill(s: OrderFillSummary, revision = 1): FormattedNotification {
  const head = [s.side ? s.side.toUpperCase() : '', s.symbol].filter(Boolean).join(' ');
  const label = phaseLabel(s);
  const tagText = tags(s).join(' · ');
  const isClose = s.action === 'close' || s.action === 'liquidation';
  const net = s.profit + s.fee;

  const lines: string[] = [`Giá ${fmtNum(s.avgPrice)} · Size ${fmtNum(s.size)} (~$${s.quote.toFixed(2)})`];
  if (isClose) lines.push(`PnL ròng ${fmtSigned(net)} USDT (gross ${fmtSigned(s.profit)}, phí ${fmtSigned(s.fee, 3)})`);
  if (s.position) {
    const p = s.position;
    lines.push(`${isClose ? 'Còn lại' : 'Vị thế'}: ${fmtNum(p.size)} @ avg ${fmtNum(p.avgPrice)} (~$${(p.size * p.avgPrice).toFixed(2)})`);
  }
  if (s.fillCount > 1) lines.push(`${s.fillCount} lần khớp`);

  const title = `${EXCHANGE_SHORT[s.exchange]} · ${head} · ${label}${tagText ? ` (${tagText})` : ''}`;

  const emoji = s.action === 'liquidation' ? '⚠️' : isClose ? (net >= 0 ? '💰' : '🔻') : '✅';
  const header = `${emoji} <b>Khớp lệnh · ${EXCHANGE_LABEL[s.exchange]}</b>${revision > 1 ? ' (khớp thêm)' : ''}`;
  const second = `<b>${escapeHtml(head)}</b> · ${escapeHtml(label)}${tagText ? ` · ${escapeHtml(tagText)}` : ''}`;
  const telegram = [header, second, ...lines.map(escapeHtml)].join('\n');

  return { title, body: lines.join('\n'), telegram };
}
