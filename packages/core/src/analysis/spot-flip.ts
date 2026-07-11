/* Spot-flip analysis math, shared by the API (on-demand `/spot-flip` view) and
 * the worker's daily 00:15 UTC snapshot job. Pure functions over raw Binance
 * kline rows so both apps compute the exact same numbers.
 *
 * Everything targets short-term spot swing trading ("lướt spot"): where price
 * sits in its recent 30-day range, how much it normally moves per day (ATR
 * proxy, so take-profit targets stay realistic), and the raw momentum numbers. */

/** A raw Binance kline row: [openTime, open, high, low, close, volume, …].
 *  Loosely typed so both apps' `BinanceKlineDto` tuples are assignable. */
export type SpotFlipKline = readonly (string | number | undefined)[];

export type SpotFlipChanges = {
  h1: number | null;
  h4: number | null;
  h24: number | null;
  d7: number | null;
  d30: number | null;
};

/** One completed daily candle, with its % change vs the previous day's close. */
export type SpotFlipHistoryPoint = {
  /** Candle open day as `YYYY-MM-DD` (UTC). */
  date: string;
  open: number;
  close: number;
  /** % change of close vs the previous day's close (null for the first day). */
  changePct: number | null;
};

export type SpotFlipMetrics = {
  changes: SpotFlipChanges;
  /** How far below the highest high of the last 30 daily candles (dip depth). */
  pullbackPct: number;
  /** How far above the lowest low of the last 30 daily candles (rebound size). */
  reboundPct: number;
  high30d: number;
  low30d: number;
  /** Average daily range % over the last 14 completed days — the ATR proxy. */
  atrPct: number;
  history: SpotFlipHistoryPoint[];
};

const num = (v: string | number | undefined): number => parseFloat(String(v));

/** close price `k` candles back from the newest (in-progress) candle. */
function closeAgo(klines: SpotFlipKline[], k: number): number | null {
  const idx = klines.length - 1 - k;
  if (idx < 0) return null;
  return num(klines[idx]![4]);
}

function pct(price: number, ref: number | null): number | null {
  if (ref == null || ref === 0) return null;
  return ((price - ref) / ref) * 100;
}

/** Compute the full spot-flip metric set from live price + hourly/daily klines.
 *  Callers must ensure at least 2 candles in each series (guard upstream). */
export function computeSpotFlip(
  price: number,
  hourly: SpotFlipKline[],
  daily: SpotFlipKline[],
): SpotFlipMetrics {
  // Momentum windows. Hourly closes for intraday, daily for 30d.
  const changes: SpotFlipChanges = {
    h1: pct(price, closeAgo(hourly, 1)),
    h4: pct(price, closeAgo(hourly, 4)),
    h24: pct(price, closeAgo(hourly, 24)),
    d7: pct(price, closeAgo(hourly, 168)),
    d30: pct(price, closeAgo(daily, 30)),
  };

  // Range over the last 30 completed daily candles (exclude in-progress).
  const completedDaily = daily.slice(0, -1);
  const last30 = completedDaily.slice(-30);
  const high30d = Math.max(...last30.map((k) => num(k[2])));
  const low30d = Math.min(...last30.map((k) => num(k[3])));
  const pullbackPct = high30d > 0 ? ((high30d - price) / high30d) * 100 : 0;
  const reboundPct = low30d > 0 ? ((price - low30d) / low30d) * 100 : 0;

  // ATR proxy: average daily range % over the last 14 completed days.
  const last14 = completedDaily.slice(-14);
  const ranges = last14
    .map((k) => {
      const high = num(k[2]);
      const low = num(k[3]);
      const close = num(k[4]);
      return close > 0 ? ((high - low) / close) * 100 : 0;
    })
    .filter((r) => Number.isFinite(r));
  const atrPct = ranges.length ? ranges.reduce((a, b) => a + b, 0) / ranges.length : 0;

  // Daily history: last 30 completed days, newest first, each with its close %
  // change vs the previous day. Keep one extra leading day so the oldest shown
  // row still has a previous close to compare against.
  const historySource = completedDaily.slice(-31);
  const history: SpotFlipHistoryPoint[] = [];
  for (let i = 1; i < historySource.length; i += 1) {
    const k = historySource[i]!;
    const prevClose = num(historySource[i - 1]![4]);
    const close = num(k[4]);
    history.push({
      date: new Date(Number(k[0])).toISOString().slice(0, 10),
      open: num(k[1]),
      close,
      changePct: prevClose > 0 ? ((close - prevClose) / prevClose) * 100 : null,
    });
  }
  history.reverse();

  return { changes, pullbackPct, reboundPct, high30d, low30d, atrPct, history };
}

/** Dual-bar shares: green "tăng giá" = headroom to the 30d high (pullbackPct),
 *  red "giảm giá" = downside to the 30d low (reboundPct). Falls back to 50/50
 *  when the range is zero. */
export function spotFlipShares(m: {
  pullbackPct: number;
  reboundPct: number;
}): { upPct: number; downPct: number } {
  const up = Math.max(0, m.pullbackPct);
  const down = Math.max(0, m.reboundPct);
  const total = up + down;
  const upPct = total > 0 ? (up / total) * 100 : 50;
  return { upPct, downPct: 100 - upPct };
}

/** Vietnamese one-line stance — the default `notes` on a daily snapshot. */
export function spotFlipSummary(m: { pullbackPct: number; atrPct: number }): string {
  const dipInAtr = m.atrPct > 0 ? m.pullbackPct / m.atrPct : null;
  const dipStr = dipInAtr != null ? ` (~${dipInAtr.toFixed(1)}× biên ngày)` : '';
  const stance =
    dipInAtr != null && dipInAtr >= 1
      ? 'Đã chỉnh sâu so với đỉnh — canh mua nhịp hồi, TP trong 1× biên ngày.'
      : 'Chưa chỉnh sâu — chờ giá về vùng chiết khấu trước khi vào.';
  return `Cách đỉnh 30N −${m.pullbackPct.toFixed(1)}%${dipStr}, biên ngày TB ${m.atrPct.toFixed(1)}%. ${stance}`;
}
