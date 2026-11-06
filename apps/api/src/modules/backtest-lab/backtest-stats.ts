import type { SandboxCandle } from './kline-loader';

/**
 * Trade list → numbers. Runs in the API (never in the sandbox), so the figures the chat reports are
 * computed the same way every time instead of being the model's own arithmetic.
 */

export type Side = 'long' | 'short';

export type NormalizedTrade = {
  symbol: string;
  side: Side;
  entryTime: number;
  /** Size-weighted (coins) average entry across all fills. */
  avgEntry: number;
  /** Number of entry fills (1 = no DCA). */
  fills: number;
  sizeUsd: number;
  coins: number;
  exitTime: number;
  exitPrice: number;
  /** true = still open at the end of the data, marked to the last close. */
  open: boolean;
  grossUsd: number;
  feesUsd: number;
  netUsd: number;
  pnlPct: number;
  /** Worst adverse move vs avgEntry while held, % (positive number = against the trade). */
  maePct: number | null;
  /** Best favourable move vs avgEntry while held, %. */
  mfePct: number | null;
  holdHours: number;
  tag: string | null;
};

export type NormalizeResult = { trades: NormalizedTrade[]; errors: string[]; invalid: number };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const round = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(d)));

function maxMin(candles: SandboxCandle[] | undefined, from: number, to: number): { hi: number; lo: number } | null {
  if (!candles?.length) return null;
  // first candle whose span covers `from`
  let lo = 0;
  let hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid]!.closeTime < from) lo = mid + 1;
    else hi = mid;
  }
  let h = -Infinity;
  let l = Infinity;
  for (let i = lo; i < candles.length && candles[i]!.time <= to; i++) {
    h = Math.max(h, candles[i]!.high);
    l = Math.min(l, candles[i]!.low);
  }
  return Number.isFinite(h) ? { hi: h, lo: l } : null;
}

/**
 * Validates the strategy's raw `trades` and prices them. `finest` = the shortest-interval candles per
 * symbol (used for open-trade marking and MAE/MFE).
 */
export function normalizeTrades(
  raw: unknown[],
  opts: { symbols: string[]; finest: Record<string, SandboxCandle[]>; feePctPerSide: number },
): NormalizeResult {
  const errors: string[] = [];
  const trades: NormalizedTrade[] = [];
  let invalid = 0;
  const fee = opts.feePctPerSide / 100;
  const fail = (i: number, msg: string) => {
    invalid++;
    if (errors.length < 10) errors.push(`trades[${i}]: ${msg}`);
  };

  raw.forEach((t0, i) => {
    const t = (t0 ?? {}) as Record<string, unknown>;
    const symbol = String(t.symbol ?? (opts.symbols.length === 1 ? opts.symbols[0] : '')).toUpperCase();
    if (!symbol) return fail(i, 'thiếu symbol');
    const side = String(t.side ?? '').toLowerCase();
    if (side !== 'long' && side !== 'short') return fail(i, `side phải là 'long' | 'short' (nhận ${JSON.stringify(t.side)})`);

    let fills: Array<{ time: number; price: number; sizeUsd: number }> = [];
    const defaultSize = num(t.sizeUsd) ?? 100;
    if (Array.isArray(t.entries) && t.entries.length) {
      for (const e0 of t.entries) {
        const e = (e0 ?? {}) as Record<string, unknown>;
        const time = num(e.time);
        const price = num(e.price);
        const size = num(e.sizeUsd) ?? defaultSize / t.entries.length;
        if (time == null || price == null || price <= 0 || size <= 0) return fail(i, 'entries[] cần {time, price>0, sizeUsd>0}');
        fills.push({ time, price, sizeUsd: size });
      }
    } else {
      const time = num(t.entryTime);
      const price = num(t.entryPrice);
      if (time == null || price == null || price <= 0) return fail(i, 'cần entryTime + entryPrice>0 (hoặc entries[])');
      if (defaultSize <= 0) return fail(i, 'sizeUsd phải > 0');
      fills = [{ time, price, sizeUsd: defaultSize }];
    }
    fills.sort((a, b) => a.time - b.time);
    const sizeUsd = fills.reduce((s, f) => s + f.sizeUsd, 0);
    const coins = fills.reduce((s, f) => s + f.sizeUsd / f.price, 0);
    const avgEntry = sizeUsd / coins;
    const entryTime = fills[0]!.time;

    const series = opts.finest[symbol];
    let exitTime = num(t.exitTime);
    let exitPrice = num(t.exitPrice);
    let open = false;
    if (exitTime == null) {
      const last = series?.[series.length - 1];
      if (!last) return fail(i, `lệnh chưa đóng nhưng không có dữ liệu ${symbol} để định giá`);
      open = true;
      exitTime = last.closeTime;
      exitPrice = last.close;
    }
    if (exitPrice == null || exitPrice <= 0) return fail(i, 'exitTime có nhưng thiếu exitPrice>0');
    if (exitTime < entryTime) return fail(i, 'exitTime trước entryTime');
    if (fills[fills.length - 1]!.time > exitTime) return fail(i, 'có lần DCA sau exitTime');

    const dir = side === 'short' ? -1 : 1;
    const grossUsd = dir * coins * (exitPrice - avgEntry);
    const feesUsd = fee * sizeUsd + (open ? 0 : fee * coins * exitPrice);
    const netUsd = grossUsd - feesUsd;
    const range = maxMin(series, entryTime, exitTime);
    const maePct = range ? (side === 'short' ? (range.hi / avgEntry - 1) * 100 : (1 - range.lo / avgEntry) * 100) : null;
    const mfePct = range ? (side === 'short' ? (1 - range.lo / avgEntry) * 100 : (range.hi / avgEntry - 1) * 100) : null;

    trades.push({
      symbol,
      side,
      entryTime,
      avgEntry,
      fills: fills.length,
      sizeUsd,
      coins,
      exitTime,
      exitPrice,
      open,
      grossUsd,
      feesUsd,
      netUsd,
      pnlPct: (netUsd / sizeUsd) * 100,
      maePct: maePct == null ? null : Math.max(0, maePct),
      mfePct: mfePct == null ? null : Math.max(0, mfePct),
      holdHours: (exitTime - entryTime) / 3_600_000,
      tag: t.tag != null ? String(t.tag).slice(0, 40) : null,
    });
  });

  return { trades, errors, invalid };
}

const median = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const pctile = (v: number[], p: number) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
};

function block(trades: NormalizedTrade[]) {
  const wins = trades.filter((t) => t.netUsd > 0);
  const losses = trades.filter((t) => t.netUsd <= 0);
  const sumWin = wins.reduce((s, t) => s + t.netUsd, 0);
  const sumLoss = losses.reduce((s, t) => s + t.netUsd, 0);
  return {
    trades: trades.length,
    winRatePct: trades.length ? round((wins.length / trades.length) * 100, 1) : null,
    netPnlUsd: round(trades.reduce((s, t) => s + t.netUsd, 0)),
    avgPnlPct: trades.length ? round(trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length) : null,
    profitFactor: sumLoss < 0 ? round(sumWin / -sumLoss) : null,
  };
}

export type BacktestStats = ReturnType<typeof computeStats>;

export function computeStats(all: NormalizedTrade[], opts: { capitalUsd: number }) {
  const closed = all.filter((t) => !t.open).sort((a, b) => a.exitTime - b.exitTime);
  const open = all.filter((t) => t.open);
  const pnl = closed.map((t) => t.pnlPct);
  const maes = closed.map((t) => t.maePct).filter((v): v is number => v != null);
  const mfes = closed.map((t) => t.mfePct).filter((v): v is number => v != null);
  const holds = closed.map((t) => t.holdHours);

  // Closed-trade equity curve (fixed size per trade, as the strategy sized them).
  let equity = opts.capitalUsd;
  let peak = equity;
  let maxDdUsd = 0;
  let maxDdPct = 0;
  let lossRun = 0;
  let maxLossRun = 0;
  for (const t of closed) {
    equity += t.netUsd;
    peak = Math.max(peak, equity);
    maxDdUsd = Math.max(maxDdUsd, peak - equity);
    if (peak > 0) maxDdPct = Math.max(maxDdPct, ((peak - equity) / peak) * 100);
    lossRun = t.netUsd <= 0 ? lossRun + 1 : 0;
    maxLossRun = Math.max(maxLossRun, lossRun);
  }

  // Capital tied up: most positions / notional open at the same time.
  const events: Array<[number, number, number]> = [];
  for (const t of all) {
    events.push([t.entryTime, 1, t.sizeUsd]);
    events.push([t.exitTime, -1, -t.sizeUsd]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let conc = 0;
  let notional = 0;
  let maxConc = 0;
  let maxNotional = 0;
  for (const [, d, n] of events) {
    conc += d;
    notional += n;
    maxConc = Math.max(maxConc, conc);
    maxNotional = Math.max(maxNotional, notional);
  }

  const bySymbol: Record<string, ReturnType<typeof block> & { worstMaePct: number | null }> = {};
  for (const sym of [...new Set(closed.map((t) => t.symbol))]) {
    const ts = closed.filter((t) => t.symbol === sym);
    const m = ts.map((t) => t.maePct).filter((v): v is number => v != null);
    bySymbol[sym] = { ...block(ts), worstMaePct: m.length ? round(Math.max(...m)) : null };
  }
  const monthGroups = new Map<string, NormalizedTrade[]>();
  for (const t of closed) {
    const k = new Date(t.exitTime).toISOString().slice(0, 7);
    monthGroups.set(k, [...(monthGroups.get(k) ?? []), t]);
  }
  const byMonth: Record<string, ReturnType<typeof block>> = {};
  for (const [k, ts] of monthGroups) byMonth[k] = block(ts);
  const sides = [...new Set(closed.map((t) => t.side))];

  return {
    closed: {
      ...block(closed),
      wins: closed.filter((t) => t.netUsd > 0).length,
      losses: closed.filter((t) => t.netUsd <= 0).length,
      grossPnlUsd: round(closed.reduce((s, t) => s + t.grossUsd, 0)),
      feesUsd: round(closed.reduce((s, t) => s + t.feesUsd, 0)),
      medianPnlPct: round(median(pnl)),
      bestPnlPct: pnl.length ? round(Math.max(...pnl)) : null,
      worstPnlPct: pnl.length ? round(Math.min(...pnl)) : null,
      returnOnCapitalPct: round((closed.reduce((s, t) => s + t.netUsd, 0) / opts.capitalUsd) * 100),
      maxDrawdownUsd: round(maxDdUsd),
      maxDrawdownPct: round(maxDdPct),
      maxConsecutiveLosses: maxLossRun,
      avgHoldHours: holds.length ? round(holds.reduce((s, v) => s + v, 0) / holds.length, 1) : null,
      medianHoldHours: round(median(holds), 1),
      maxHoldHours: holds.length ? round(Math.max(...holds), 1) : null,
      dcaTrades: closed.filter((t) => t.fills > 1).length,
    },
    mae: {
      avgPct: maes.length ? round(maes.reduce((s, v) => s + v, 0) / maes.length) : null,
      p90Pct: round(pctile(maes, 90)),
      maxPct: maes.length ? round(Math.max(...maes)) : null,
      tradesOver10Pct: maes.filter((v) => v >= 10).length,
      tradesOver20Pct: maes.filter((v) => v >= 20).length,
      tradesOver50Pct: maes.filter((v) => v >= 50).length,
      avgMfePct: mfes.length ? round(mfes.reduce((s, v) => s + v, 0) / mfes.length) : null,
    },
    exposure: { maxConcurrentTrades: maxConc, peakNotionalUsd: round(maxNotional) },
    open: {
      trades: open.length,
      unrealizedUsd: round(open.reduce((s, t) => s + t.netUsd, 0)),
      worstOpenPnlPct: open.length ? round(Math.min(...open.map((t) => t.pnlPct))) : null,
    },
    bySide: sides.length > 1 ? Object.fromEntries(sides.map((s) => [s, block(closed.filter((t) => t.side === s))])) : null,
    bySymbol,
    byMonth,
  };
}

/** Compact row for storage / the chat: [symbol, side, entryISO, avgEntry, exitISO, exit, sizeUsd, pnlPct, netUsd, maePct, holdH, fills, open, tag] */
export function compactTrade(t: NormalizedTrade) {
  return {
    s: t.symbol,
    side: t.side,
    in: new Date(t.entryTime).toISOString().slice(0, 16),
    avg: Number(t.avgEntry.toPrecision(6)),
    out: new Date(t.exitTime).toISOString().slice(0, 16),
    exit: Number(t.exitPrice.toPrecision(6)),
    usd: round(t.sizeUsd),
    pnlPct: round(t.pnlPct),
    net: round(t.netUsd),
    mae: round(t.maePct),
    holdH: round(t.holdHours, 1),
    ...(t.fills > 1 ? { fills: t.fills } : {}),
    ...(t.open ? { open: true } : {}),
    ...(t.tag ? { tag: t.tag } : {}),
  };
}
