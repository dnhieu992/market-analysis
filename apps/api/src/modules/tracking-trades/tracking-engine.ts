/**
 * Paper engine for /tracking-coins swing setups, replayed on 1m candles.
 *
 * PENDING → OPEN when a LIMIT (pullback) or STOP (breakout) entry is touched; a gap fills at the
 * candle's open. OPEN: the stop is checked first (worst case when a candle spans both), then the
 * targets in order — each closes its share of the filled size. TP1 moves the stop to break-even,
 * TP2 moves it to TP1. The last target (or the stop) closes what is left.
 */

export const FEE_PCT = 0.0005; // per side, same as the other paper engines
export const DEFAULT_TARGET_PCTS: Record<number, number[]> = { 1: [100], 2: [50, 50], 3: [50, 30, 20] };
const HOUR = 3_600_000;
const MINUTE = 60_000;
const PATH_MAX_HOURS = 24 * 120;
const EPS = 1e-12;

export type Direction = 'LONG' | 'SHORT';
export type OrderType = 'LIMIT' | 'STOP' | 'MARKET';
export type Target = { price: number; pct: number; hitAt?: string | null; exitPrice?: number | null };
export type Bar = { t: number; closeT: number; open: number; high: number; low: number; close: number };

export type EngineEvent = {
  type: 'FILLED' | 'TP_HIT' | 'STOP_MOVED' | 'STOPPED' | 'CLOSED';
  at: number;
  price: number;
  message: string;
  data?: Record<string, unknown>;
};

export type EngineState = {
  status: 'PENDING' | 'OPEN' | 'CLOSED';
  direction: Direction;
  orderType: OrderType;
  entryPrice: number;
  stopLoss: number;
  targets: Target[];
  riskUsd: number;
  fillPrice: number | null;
  quantity: number | null;
  remainingQty: number | null;
  currentStop: number | null;
  filledAt: number | null;
  closedAt: number | null;
  closeReason: 'TP' | 'SL' | 'BE' | 'TRAIL' | 'MANUAL' | null;
  realizedPnlUsd: number;
  mfeR: number | null;
  maeR: number | null;
  mfeAt: number | null;
  maeAt: number | null;
  pathR: number[];
};

const sign = (d: Direction) => (d === 'SHORT' ? -1 : 1);
const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

/** Significant-digit price for messages, so micro-priced coins stay readable. */
export const fmtPx = (n: number) => String(Number(n.toPrecision(6)));

/** Net PnL of one leg, fees on both sides. */
export function legPnl(qty: number, entry: number, exit: number, direction: Direction): number {
  return qty * (exit - entry) * sign(direction) - (qty * entry + qty * exit) * FEE_PCT;
}

/** Target list from prices (in order) and optional percentages; the default split is 50/30/20. */
export function buildTargets(prices: number[], pcts?: Array<number | null | undefined>): Target[] {
  const clean = prices.filter((p) => Number.isFinite(p) && p > 0);
  const defaults = DEFAULT_TARGET_PCTS[clean.length] ?? clean.map(() => 100 / clean.length);
  const given = clean.map((_, i) => pcts?.[i]);
  const useGiven = given.every((p) => p != null && p > 0) && Math.abs(given.reduce<number>((a, p) => a + (p ?? 0), 0) - 100) < 0.01;
  return clean.map((price, i) => ({ price, pct: useGiven ? given[i]! : defaults[i]!, hitAt: null, exitPrice: null }));
}

/** Why a plan can't be traded, or null when entry / stop / targets line up for its direction. */
export function validatePlan(direction: Direction, entry: number, stop: number, targets: Target[]): string | null {
  const d = sign(direction);
  if (!(entry > 0) || !(stop > 0)) return 'Entry và SL phải là số dương.';
  if (targets.length === 0 || targets.length > 3) return 'Cần 1–3 mức chốt lời.';
  if ((entry - stop) * d <= 0) return direction === 'LONG' ? 'LONG: SL phải thấp hơn entry.' : 'SHORT: SL phải cao hơn entry.';
  let prev = entry;
  for (const [i, t] of targets.entries()) {
    if ((t.price - prev) * d <= 0) return `TP${i + 1} phải ${direction === 'LONG' ? 'cao' : 'thấp'} hơn ${i === 0 ? 'entry' : `TP${i}`}.`;
    prev = t.price;
  }
  const sum = targets.reduce((a, t) => a + t.pct, 0);
  if (Math.abs(sum - 100) > 0.01) return 'Tổng % chốt các TP phải bằng 100.';
  return null;
}

/** R:R of each target from the planned entry and stop. */
export function plannedRR(entry: number, stop: number, targets: Target[]): number[] {
  const risk = Math.abs(entry - stop);
  return targets.map((t) => round(Math.abs(t.price - entry) / risk, 2));
}

/** Opens the trade at `price` (a MARKET order now, or a LIMIT/STOP fill). */
export function fill(s: EngineState, price: number, at: number): EngineEvent[] {
  const d = sign(s.direction);
  const risk = (price - s.stopLoss) * d;
  s.status = 'OPEN';
  s.fillPrice = price;
  s.filledAt = at;
  s.currentStop = s.stopLoss;
  s.mfeR = 0;
  s.maeR = 0;
  const events: EngineEvent[] = [];
  if (risk <= 0) {
    // Filled already beyond the stop (gap) — out at once for the full planned risk.
    s.quantity = s.riskUsd / Math.abs(s.entryPrice - s.stopLoss);
    s.remainingQty = s.quantity;
    events.push({ type: 'FILLED', at, price, message: `Khớp ${s.direction} @ ${fmtPx(price)} — đã vượt SL ngay khi khớp.` });
    events.push(...closeRest(s, price, at, 'SL'));
    return events;
  }
  s.quantity = s.riskUsd / risk;
  s.remainingQty = s.quantity;
  events.push({ type: 'FILLED', at, price, message: `Khớp ${s.direction} @ ${fmtPx(price)}. SL ${fmtPx(s.stopLoss)}, 1R = $${round(s.riskUsd, 2)}.` });
  return events;
}

/** Closes what is left at `price`. */
export function closeRest(s: EngineState, price: number, at: number, reason: NonNullable<EngineState['closeReason']>): EngineEvent[] {
  const qty = s.remainingQty ?? 0;
  if (qty > EPS) s.realizedPnlUsd += legPnl(qty, s.fillPrice!, price, s.direction);
  s.remainingQty = 0;
  s.status = 'CLOSED';
  s.closedAt = at;
  s.closeReason = reason;
  const r = s.realizedPnlUsd / s.riskUsd;
  const label = { TP: 'chạm TP cuối', SL: 'dính SL', BE: 'về hoà vốn', TRAIL: 'dính SL dời', MANUAL: 'đóng tay' }[reason];
  return [{ type: 'CLOSED', at, price, message: `Đóng lệnh (${label}) @ ${fmtPx(price)}. Kết quả ${r >= 0 ? '+' : ''}${round(r, 2)}R ($${round(s.realizedPnlUsd, 2)}).`, data: { reason, rMultiple: round(r, 3) } }];
}

/** R of a price relative to the fill and the initial risk. */
function rAt(s: EngineState, price: number): number {
  const risk = Math.abs(s.fillPrice! - s.stopLoss) || Math.abs(s.entryPrice - s.stopLoss);
  return ((price - s.fillPrice!) * sign(s.direction)) / risk;
}

function trackExcursion(s: EngineState, b: Bar, partial: boolean) {
  const d = sign(s.direction);
  const best = rAt(s, partial ? b.close : d === 1 ? b.high : b.low);
  const worst = rAt(s, partial ? b.close : d === 1 ? b.low : b.high);
  if (s.mfeR == null || best > s.mfeR) { s.mfeR = round(best); s.mfeAt = b.closeT; }
  if (s.maeR == null || worst < s.maeR) { s.maeR = round(worst); s.maeAt = b.closeT; }
}

/** Replays whole 1m candles in time order. Returns the milestones that happened. */
export function step(s: EngineState, bars: Bar[]): EngineEvent[] {
  const events: EngineEvent[] = [];
  const d = sign(s.direction);
  const against = (b: Bar, p: number) => (d === 1 ? b.low <= p : b.high >= p);
  const withTrade = (b: Bar, p: number) => (d === 1 ? b.high >= p : b.low <= p);

  for (const b of bars) {
    if (s.status === 'CLOSED') break;

    if (s.status === 'PENDING') {
      const limit = s.orderType === 'LIMIT';
      if (!(limit ? against(b, s.entryPrice) : withTrade(b, s.entryPrice))) continue;
      const gapped = limit ? (b.open - s.entryPrice) * d < 0 : (b.open - s.entryPrice) * d > 0;
      events.push(...fill(s, gapped ? b.open : s.entryPrice, b.t));
      if ((s.status as EngineState['status']) !== 'OPEN') break; // gapped straight through the stop
      trackExcursion(s, b, true);
      // Same candle: only the stop counts (we can't know whether a target came after the fill).
      if (against(b, s.currentStop!)) {
        events.push({ type: 'STOPPED', at: b.closeT, price: s.currentStop!, message: `Dính SL @ ${fmtPx(s.currentStop!)} ngay trong nến khớp.` });
        events.push(...closeRest(s, s.currentStop!, b.closeT, 'SL'));
        break;
      }
      continue;
    }

    // OPEN
    trackExcursion(s, b, false);
    if (against(b, s.currentStop!)) {
      const gap = (b.open - s.currentStop!) * d < 0;
      const px = gap ? b.open : s.currentStop!;
      const anyHit = s.targets.some((t) => t.hitAt);
      const reason = !anyHit ? 'SL' : Math.abs(s.currentStop! - s.fillPrice!) < EPS ? 'BE' : 'TRAIL';
      events.push({ type: 'STOPPED', at: b.closeT, price: px, message: `Chạm SL ${fmtPx(s.currentStop!)}${gap ? ` (gap, khớp ${fmtPx(px)})` : ''}.` });
      events.push(...closeRest(s, px, b.closeT, reason));
      break;
    }

    for (const [i, t] of s.targets.entries()) {
      if (t.hitAt || !withTrade(b, t.price)) continue;
      const last = s.targets.slice(i + 1).every((x) => x.hitAt) || i === s.targets.length - 1;
      const qty = last ? s.remainingQty! : Math.min(s.remainingQty!, (s.quantity! * t.pct) / 100);
      s.realizedPnlUsd += legPnl(qty, s.fillPrice!, t.price, s.direction);
      s.remainingQty = Math.max(0, s.remainingQty! - qty);
      t.hitAt = new Date(b.closeT).toISOString();
      t.exitPrice = t.price;
      events.push({ type: 'TP_HIT', at: b.closeT, price: t.price, message: `Chạm TP${i + 1} @ ${fmtPx(t.price)} — chốt ${last ? 'phần còn lại' : `${t.pct}%`}.`, data: { index: i } });
      if (s.remainingQty <= EPS * Math.max(1, s.quantity!)) {
        events.push(...closeRest(s, t.price, b.closeT, 'TP'));
        break;
      }
      // TP1 → stop to break-even, TP2 → stop to TP1 (only ever tightened).
      const newStop = i === 0 ? s.fillPrice! : s.targets[i - 1]!.price;
      if ((newStop - s.currentStop!) * d > 0) {
        s.currentStop = newStop;
        events.push({ type: 'STOP_MOVED', at: b.closeT, price: newStop, message: `Dời SL lên ${i === 0 ? 'hoà vốn' : 'TP1'} ${fmtPx(newStop)} (tự động).`, data: { auto: true } });
      }
    }
    if (s.status !== 'OPEN') break;

    // R at each 1h close since the fill — the price path kept for later statistics.
    if ((b.t + MINUTE) % HOUR === 0 && s.pathR.length < PATH_MAX_HOURS) s.pathR.push(round(rAt(s, b.close)));
  }
  return events;
}

/** Closes `pct`% of what is left at `price` by hand. */
export function closeManually(s: EngineState, pct: number, price: number, at: number): EngineEvent[] {
  if (s.status !== 'OPEN') throw new Error('Lệnh không ở trạng thái đang mở.');
  const share = Math.min(100, Math.max(0, pct)) / 100;
  const qty = s.remainingQty! * share;
  if (share >= 0.999) return closeRest(s, price, at, 'MANUAL');
  s.realizedPnlUsd += legPnl(qty, s.fillPrice!, price, s.direction);
  s.remainingQty = s.remainingQty! - qty;
  return [];
}
