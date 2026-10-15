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

import { PAPER_SYMBOLS } from './paper-symbols';

export type PaperCandle ={ t: number; closeT: number; open: number; high: number; low: number; close: number; volume: number };

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
  /**
   * 1h trend filter (2026-10-15 review): skip a LONG when the last closed 1h candle is in a
   * downtrend, skip a SHORT when it is in an uptrend. See `h1TrendAt`.
   */
  trendFilter?: boolean;
  /** Anti-chase (LONG only): skip when the 1h close is up ≥ this % vs 24 closed 1h candles earlier. */
  maxRise24hPct?: number;
  /** Once price has run `atR` in favour, move the stop to entry + `lockR` (closes as 'BE'). */
  breakeven?: { atR: number; lockR: number };
  /** Close at the candle close once the trade has been open this long (closes as 'TIME'). */
  maxHoldHours?: number;
  slPct: number;
  rr: number;
  /** BTC backtest of the shipped rules (scripts/run-paper-strategies-backtest.ts); `coins` = the other coins. */
  backtest: { trades: number; perDay: number; winRate: number; totalR: number; byYear: string; coins: string };
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
    backtest: { trades: 727, perDay: 0.71, winRate: 57.1, totalR: 30.4, byYear: '57.5 / 55.6 / 58.4', coins: 'ETH 946 lệnh · WR 53.5% · −28.6R | SOL 1265 lệnh · WR 51.2% · −95.5R' },
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
    backtest: { trades: 720, perDay: 0.71, winRate: 54.7, totalR: 20.0, byYear: '55.2 / 54.8 / 53.5', coins: 'ETH 1016 lệnh · WR 51.9% · −29.8R | SOL 1524 lệnh · WR 50.3% · −91.6R' },
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
    trendFilter: true,
    maxRise24hPct: 1,
    slPct: 0.015,
    rr: 1.5,
    backtest: { trades: 280, perDay: 0.28, winRate: 45.4, totalR: 18.8, byYear: '48.6 / 45.8 / 39.7', coins: 'ETH 317 lệnh · WR 43.2% · +4.4R | SOL 372 lệnh · WR 40.1% · −24.3R' },
    rules: 'Giá tạo đáy mới 20 nến nhưng RSI(7) cao hơn đáy RSI trước (<30) · nến 5m xanh · volume < MA20 · RSI14 1h ≥ 40 · 1h không ở xu hướng giảm (giá & EMA50 dưới EMA200) · giá 1h tăng < 1% so với 24h trước · SL 1.5% · TP 1.5R',
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
    trendFilter: true,
    maxRise24hPct: 1,
    slPct: 0.015,
    rr: 2,
    backtest: { trades: 295, perDay: 0.29, winRate: 37.3, totalR: 15.3, byYear: '42.1 / 35.6 / 30.7', coins: 'ETH 379 lệnh · WR 34.8% · −8.3R | SOL 472 lệnh · WR 36.2% · +9.5R' },
    rules: 'Nến 15m xanh đóng cửa làm RSI(7) cắt lên trên 50 · volume < MA20 · RSI14 1h ≥ 40 · RSI14 1D ≥ 30 · 1h không ở xu hướng giảm (giá & EMA50 dưới EMA200) · giá 1h tăng < 1% so với 24h trước · SL 1.5% · TP 2R',
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

/** EMA seeded with the first value. */
export function ema(values: number[], p: number): number[] {
  const out = new Array<number>(values.length);
  const a = 2 / (p + 1);
  let e = values[0] ?? 0;
  for (let i = 0; i < values.length; i += 1) {
    e = a * values[i]! + (1 - a) * e;
    out[i] = e;
  }
  return out;
}

/** Index of the last higher-TF candle closed at or before `closeT` (-1 if none). */
export function htfIndexAt(htf: PaperCandle[], closeT: number): number {
  let lo = 0;
  let hi = htf.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (htf[mid]!.closeT <= closeT) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

/** RSI14 of the last higher-TF candle closed at or before `closeT` (null if none). */
export function htfRsiAt(htf: PaperCandle[], htfRsi: number[], closeT: number): number | null {
  const found = htfIndexAt(htf, closeT);
  return found >= 0 ? htfRsi[found]! : null;
}

/** 1h trend at candle `j`: UP = close and EMA50 both above EMA200, DOWN = both below, else MIX. */
export function h1TrendAt(ctx: SignalContext, j: number): 'UP' | 'DOWN' | 'MIX' {
  const c = ctx.h1[j]!.close;
  const e50 = ctx.h1Ema50[j]!;
  const e200 = ctx.h1Ema200[j]!;
  if (c > e200 && e50 > e200) return 'UP';
  if (c < e200 && e50 < e200) return 'DOWN';
  return 'MIX';
}

const inBounds = (x: number | null, b?: { min?: number; max?: number }) =>
  !b || (x != null && (b.min == null || x >= b.min) && (b.max == null || x <= b.max));

export type SignalContext = {
  ltf: PaperCandle[]; // CLOSED candles of the strategy timeframe, oldest first
  ltfRsi: number[];
  h1: PaperCandle[];
  h1Rsi: number[];
  h1Ema50: number[];
  h1Ema200: number[];
  d1: PaperCandle[];
  d1Rsi: number[];
};

/** Build the context from closed candles (shared by the live engine and the backtest script). */
export function buildContext(def: RsiVolumeStrategyDef, ltf: PaperCandle[], h1: PaperCandle[], d1: PaperCandle[]): SignalContext {
  const h1Close = h1.map((c) => c.close);
  return {
    ltf,
    ltfRsi: wilderRsi(ltf.map((c) => c.close), def.rsiPeriod),
    h1,
    h1Rsi: wilderRsi(h1Close, 14),
    h1Ema50: ema(h1Close, 50),
    h1Ema200: ema(h1Close, 200),
    d1,
    d1Rsi: wilderRsi(d1.map((c) => c.close), 14),
  };
}

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

  if (def.trendFilter || def.maxRise24hPct != null) {
    const j = htfIndexAt(ctx.h1, bar.closeT);
    if (j < 0) return false;
    if (def.trendFilter) {
      const trend = h1TrendAt(ctx, j);
      if (def.direction === 'LONG' ? trend === 'DOWN' : trend === 'UP') return false;
    }
    if (def.maxRise24hPct != null && def.direction === 'LONG') {
      if (j < 24) return false;
      const rise = (ctx.h1[j]!.close / ctx.h1[j - 24]!.close - 1) * 100;
      if (rise >= def.maxRise24hPct) return false;
    }
  }
  return true;
}

/** Stop / take-profit for an entry price. */
export function levelsFor(def: RsiVolumeStrategyDef, entry: number): { stop: number; takeProfit: number; risk: number } {
  const risk = entry * def.slPct;
  const dir = def.direction === 'LONG' ? 1 : -1;
  return { stop: entry - dir * risk, takeProfit: entry + dir * def.rr * risk, risk };
}

export type ExitReason = 'TP' | 'SL' | 'BE' | 'TIME';

export type OpenPosition = {
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  initialStopLoss: number;
  stopLoss: number;
  takeProfit: number;
  openedAt: number; // ms, open time of the entry candle
};

/**
 * Advance an open position by one CLOSED candle. Order inside the candle: stop (SL, or 'BE' once
 * the stop was moved) → take-profit → max-hold time exit at the close → breakeven trigger (the
 * moved stop only applies from the NEXT candle, so a candle never both arms and hits it).
 */
export function stepPosition(
  def: Pick<RsiVolumeStrategyDef, 'breakeven' | 'maxHoldHours'>,
  pos: OpenPosition,
  c: PaperCandle,
): { exit: { price: number; reason: ExitReason; at: number } | null; stopLoss: number } {
  const long = pos.direction === 'LONG';
  const moved = pos.stopLoss !== pos.initialStopLoss;
  if (long ? c.low <= pos.stopLoss : c.high >= pos.stopLoss) {
    return { exit: { price: pos.stopLoss, reason: moved ? 'BE' : 'SL', at: c.closeT }, stopLoss: pos.stopLoss };
  }
  if (long ? c.high >= pos.takeProfit : c.low <= pos.takeProfit) {
    return { exit: { price: pos.takeProfit, reason: 'TP', at: c.closeT }, stopLoss: pos.stopLoss };
  }
  if (def.maxHoldHours != null && c.closeT + 1 - pos.openedAt >= def.maxHoldHours * 36e5) {
    return { exit: { price: c.close, reason: 'TIME', at: c.closeT }, stopLoss: pos.stopLoss };
  }
  let stopLoss = pos.stopLoss;
  if (def.breakeven && !moved) {
    const risk = Math.abs(pos.entryPrice - pos.initialStopLoss);
    const fav = long ? c.high - pos.entryPrice : pos.entryPrice - c.low;
    if (fav >= def.breakeven.atR * risk) {
      stopLoss = long ? pos.entryPrice + def.breakeven.lockR * risk : pos.entryPrice - def.breakeven.lockR * risk;
    }
  }
  return { exit: null, stopLoss };
}

/** Default "Chi tiết chiến lược" markdown for a strategy. */
export function defaultDocFor(def: RsiVolumeStrategyDef): string {
  const side = def.direction === 'LONG' ? 'MUA' : 'BÁN';
  const coins = PAPER_SYMBOLS.map((s) => s.short).join(', ');
  const reviewNote = def.trendFilter || def.maxRise24hPct != null
    ? `\n**Cập nhật 2026-10-15 (sau review 89 lệnh paper)**
- Lệnh thua live tập trung ở pha **mua đuổi** (giá 1h đã tăng ≥ 1% trong 24h) và **mua ngược xu hướng giảm 1h**.
- Đã thêm 2 bộ lọc: bỏ tín hiệu khi 1h đang giảm (giá & EMA50 dưới EMA200), bỏ tín hiệu khi giá 1h tăng ≥ 1% so với 24h trước.
- Backtest dài hạn: hai bộ lọc giảm số lệnh ~55% nhưng tăng kỳ vọng/lệnh và giảm mạnh drawdown.
`
    : '';
  return `## ${def.name}

**Quy tắc vào lệnh (${side}, khung ${def.timeframe}, chạy trên ${coins})**
${def.rules.split(' · ').map((x) => `- ${x}`).join('\n')}
- Vào lệnh ở giá mở cửa của nến kế tiếp sau nến tín hiệu.

**Quản lý lệnh**
- Cắt lỗ cố định ${(def.slPct * 100).toFixed(1)}% từ giá vào, chốt lời ${def.rr}R. Không đóng cuối ngày, không dời SL.
- Mỗi chiến lược chỉ giữ **1 lệnh tại một thời điểm trên mỗi coin**; các chiến lược chạy song song, độc lập.
${reviewNote}
**Backtest 2024-01 → 2026-10 (phí 0.05%/chiều, \`scripts/run-paper-strategies-backtest.ts\`)**
- BTC: ${def.backtest.trades} lệnh (~${def.backtest.perDay} lệnh/ngày), win rate **${def.backtest.winRate}%**, tổng **+${def.backtest.totalR}R**.
- BTC win rate theo năm 2024 / 2025 / 2026: ${def.backtest.byYear}%.
- Coin khác: ${def.backtest.coins.split(' | ').join(' · ')}.
- Chiến lược được dò trên BTC — ETH/SOL chạy để kiểm chứng, kết quả âm ở coin nào thì coi như chưa có edge ở coin đó.
- Edge mỏng — đây là paper-trade để kiểm chứng trên dữ liệu thật, không nối sàn.
`;
}
