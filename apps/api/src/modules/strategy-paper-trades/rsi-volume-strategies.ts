/**
 * RSI + FxCanli Volume paper strategies — the high-frequency winners of the 2026-09-28
 * backtest (claude-backtest/runs/2026-09-28-btc-rsi-volume-winrate-hunt.md). Pure logic,
 * no Nest/DB: the engine feeds closed candles in and gets a signal back. Rules mirror
 * claude-backtest/scripts/rsi-volume-winrate/sweep2.py exactly:
 *  - decided on the CLOSE of the signal candle, entry at the next candle's open;
 *  - RSI = Wilder RSI; volume ratio = volume / SMA20(volume) incl. the signal candle;
 *  - higher-TF RSI14 = last 1h / 1d candle CLOSED at or before the signal candle's close;
 *  - SL = fixed % from entry, TP = rr × risk, SL checked before TP inside a candle.
 */

export type PaperCandle = { t: number; closeT: number; open: number; high: number; low: number; close: number; volume: number };

export type RsiVolumeStrategyDef = {
  id: string;
  name: string;
  timeframe: '5m' | '15m';
  direction: 'LONG' | 'SHORT';
  rsiPeriod: number;
  /**
   * cross_back     — LONG: RSI crosses back up through `level` (prev < level ≤ now).
   * momentum_cross — LONG: RSI crosses up through `level`; SHORT: crosses down through `level` (prev > level ≥ now).
   * divergence     — LONG: bullish RSI divergence (new `divN`-bar low, RSI > prior RSI low + 3, prior RSI low < `level`)
   *                  on the signal candle or the one before.
   */
  trigger: 'cross_back' | 'momentum_cross' | 'divergence';
  level: number;
  divN?: number;
  /** Volume filter vs the FxCanli MA20: none, or volume below its MA20 (quiet pullback). */
  volume: 'none' | 'below_ma';
  /** Inclusive RSI14 bounds of the 1h / 1d candle (undefined = no bound). */
  h1Rsi?: { min?: number; max?: number };
  d1Rsi?: { min?: number; max?: number };
  slPct: number;
  rr: number;
  backtest: { trades: number; perDay: number; winRate: number; totalR: number; byYear: string };
  rules: string;
};

export const RSI_VOLUME_STRATEGIES: RsiVolumeStrategyDef[] = [
  {
    id: 'rsi-5m-short-1r',
    name: 'A · 5m BÁN — RSI14 gãy 45 khi 1h yếu (1R)',
    timeframe: '5m',
    direction: 'SHORT',
    rsiPeriod: 14,
    trigger: 'momentum_cross',
    level: 45,
    volume: 'none',
    h1Rsi: { max: 40 },
    d1Rsi: { max: 60 },
    slPct: 0.01,
    rr: 1,
    backtest: { trades: 726, perDay: 0.73, winRate: 56.9, totalR: 27.4, byYear: '57.6 / 55.6 / 57.6' },
    rules: 'Nến 5m đỏ đóng cửa làm RSI(14) cắt xuống dưới 45 · RSI14 1h ≤ 40 · RSI14 1D ≤ 60 · SL 1% · TP 1R',
  },
  {
    id: 'rsi-5m-long-1r',
    name: 'B · 5m MUA — RSI7 bật lên 30 trong xu hướng tăng (1R)',
    timeframe: '5m',
    direction: 'LONG',
    rsiPeriod: 7,
    trigger: 'cross_back',
    level: 30,
    volume: 'none',
    h1Rsi: { min: 40 },
    d1Rsi: { min: 50 },
    slPct: 0.015,
    rr: 1,
    backtest: { trades: 707, perDay: 0.71, winRate: 54.6, totalR: 17.9, byYear: '54.8 / 54.8 / 53.8' },
    rules: 'Nến 5m xanh đóng cửa làm RSI(7) cắt ngược lên trên 30 · RSI14 1h ≥ 40 · RSI14 1D ≥ 50 · SL 1.5% · TP 1R',
  },
  {
    id: 'rsi-5m-long-div-1_5r',
    name: 'C · 5m MUA — phân kỳ RSI7, volume thấp (1.5R)',
    timeframe: '5m',
    direction: 'LONG',
    rsiPeriod: 7,
    trigger: 'divergence',
    level: 30,
    divN: 20,
    volume: 'below_ma',
    h1Rsi: { min: 40 },
    slPct: 0.015,
    rr: 1.5,
    backtest: { trades: 666, perDay: 0.67, winRate: 44.0, totalR: 21.7, byYear: '46.6 / 43.3 / 40.8' },
    rules: 'Giá tạo đáy mới 20 nến nhưng RSI(7) cao hơn đáy RSI trước (<30) · nến 5m xanh · volume < MA20 · RSI14 1h ≥ 40 · SL 1.5% · TP 1.5R',
  },
  {
    id: 'rsi-15m-long-2r',
    name: 'D · 15m MUA — RSI7 vượt 50, volume thấp (2R)',
    timeframe: '15m',
    direction: 'LONG',
    rsiPeriod: 7,
    trigger: 'momentum_cross',
    level: 50,
    volume: 'below_ma',
    h1Rsi: { min: 40 },
    d1Rsi: { min: 30 },
    slPct: 0.015,
    rr: 2,
    backtest: { trades: 662, perDay: 0.66, winRate: 36.9, totalR: 25.9, byYear: '39.6 / 35.3 / 33.3' },
    rules: 'Nến 15m xanh đóng cửa làm RSI(7) cắt lên trên 50 · volume < MA20 · RSI14 1h ≥ 40 · RSI14 1D ≥ 30 · SL 1.5% · TP 2R',
  },
];

export const TF_MS: Record<string, number> = { '5m': 3e5, '15m': 9e5, '1h': 36e5, '1d': 864e5 };

/** Wilder RSI, same seeding as the backtest engine (first `p` bars → 50). */
export function wilderRsi(closes: number[], p: number): number[] {
  const n = closes.length;
  const out = new Array<number>(n).fill(50);
  let ru = 0;
  let rd = 0;
  const a = 1 / p;
  for (let i = 1; i < n; i += 1) {
    const d = closes[i]! - closes[i - 1]!;
    const u = d > 0 ? d : 0;
    const w = d < 0 ? -d : 0;
    if (i <= p) { ru += u / p; rd += w / p; }
    else { ru = ru * (1 - a) + u * a; rd = rd * (1 - a) + w * a; }
    if (i >= p) out[i] = rd === 0 ? 100 : 100 - 100 / (1 + ru / rd);
  }
  return out;
}

/** RSI14 of the last higher-TF candle closed at or before `closeT` (null if none). */
export function htfRsiAt(htf: PaperCandle[], htfRsi: number[], closeT: number): number | null {
  let lo = 0;
  let hi = htf.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (htf[mid]!.closeT <= closeT) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found >= 0 ? htfRsi[found]! : null;
}

const inBounds = (x: number | null, b?: { min?: number; max?: number }) =>
  !b || (x != null && (b.min == null || x >= b.min) && (b.max == null || x <= b.max));

export type SignalContext = {
  ltf: PaperCandle[]; // CLOSED candles of the strategy timeframe, oldest first
  ltfRsi: number[];
  h1: PaperCandle[];
  h1Rsi: number[];
  d1: PaperCandle[];
  d1Rsi: number[];
};

/** Does candle `i` of `ctx.ltf` (closed) fire the strategy? Needs ≥ 60 bars of history. */
export function firesAt(def: RsiVolumeStrategyDef, ctx: SignalContext, i: number): boolean {
  const c = ctx.ltf;
  const r = ctx.ltfRsi;
  if (i < 60 || i >= c.length) return false;
  const bar = c[i]!;
  const bull = bar.close > bar.open;
  const bear = bar.close < bar.open;

  let trig = false;
  if (def.trigger === 'cross_back') {
    trig = def.direction === 'LONG'
      ? r[i - 1]! < def.level && r[i]! >= def.level && bull
      : r[i - 1]! > def.level && r[i]! <= def.level && bear;
  } else if (def.trigger === 'momentum_cross') {
    trig = def.direction === 'LONG'
      ? r[i - 1]! < def.level && r[i]! >= def.level && bull
      : r[i - 1]! > def.level && r[i]! <= def.level && bear;
  } else {
    const n = def.divN ?? 20;
    const divAt = (j: number) => {
      let minL = Infinity;
      let minR = Infinity;
      for (let k = Math.max(0, j - n); k < j; k += 1) {
        if (c[k]!.low < minL) minL = c[k]!.low;
        if (r[k]! < minR) minR = r[k]!;
      }
      return c[j]!.low < minL && r[j]! > minR + 3 && minR < def.level;
    };
    trig = def.direction === 'LONG' && bull && (divAt(i) || divAt(i - 1));
  }
  if (!trig) return false;

  if (def.volume === 'below_ma') {
    let s = 0;
    for (let k = i - 19; k <= i; k += 1) s += c[k]!.volume;
    if (!(bar.volume < s / 20)) return false;
  }

  if (!inBounds(htfRsiAt(ctx.h1, ctx.h1Rsi, bar.closeT), def.h1Rsi)) return false;
  if (!inBounds(htfRsiAt(ctx.d1, ctx.d1Rsi, bar.closeT), def.d1Rsi)) return false;
  return true;
}

/** Stop / take-profit for an entry price. */
export function levelsFor(def: RsiVolumeStrategyDef, entry: number): { stop: number; takeProfit: number; risk: number } {
  const risk = entry * def.slPct;
  const dir = def.direction === 'LONG' ? 1 : -1;
  return { stop: entry - dir * risk, takeProfit: entry + dir * def.rr * risk, risk };
}

/** Default "Chi tiết chiến lược" markdown for a strategy. */
export function defaultDocFor(def: RsiVolumeStrategyDef): string {
  const side = def.direction === 'LONG' ? 'MUA' : 'BÁN';
  return `## ${def.name}

**Quy tắc vào lệnh (${side}, BTC khung ${def.timeframe})**
${def.rules.split(' · ').map((x) => `- ${x}`).join('\n')}
- Vào lệnh ở giá mở cửa của nến kế tiếp sau nến tín hiệu.

**Quản lý lệnh**
- Cắt lỗ cố định ${(def.slPct * 100).toFixed(1)}% từ giá vào, chốt lời ${def.rr}R. Không đóng cuối ngày, không dời SL.
- Mỗi chiến lược chỉ giữ **1 lệnh tại một thời điểm**; các chiến lược chạy song song, độc lập.

**Backtest 2024-01 → 2026-09 (phí 0.05%/chiều)**
- ${def.backtest.trades} lệnh (~${def.backtest.perDay} lệnh/ngày), win rate **${def.backtest.winRate}%**, tổng **+${def.backtest.totalR}R**.
- Win rate theo năm 2024 / 2025 / 2026: ${def.backtest.byYear}%.
- Edge mỏng — đây là paper-trade để kiểm chứng trên dữ liệu thật, không nối sàn.
`;
}
