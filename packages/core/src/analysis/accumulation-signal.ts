import { calculateEma } from '../indicators/ema';
import { calculateRsi } from '../indicators/rsi';

/**
 * Accumulation-zone DCA signal (spot, NO stop-loss).
 *
 * The user's flow: buy a beaten-down coin while it sits in a tight sideways base
 * ("vùng tích luỹ"), spot, no stop-loss, and HOLD for a full exit at x2 (+100% off
 * average cost) — the merged bottom-DCA strategy, not a swing/EMA34 bounce.
 *
 * Backtest verdict (claude-backtest/runs/2026-07-12-bottom-dca-x2x3-merged, supersedes
 * 2026-06-29-accumulation-zone-no-sl): entering in the accumulation zone and selling on
 * the EMA34 reclaim is net-NEGATIVE (PF 0.72–0.81) — the small wins can't offset the
 * no-SL tail. Two things fix it: (1) hold winners to a FULL exit at x2 — the sweet spot
 * (PF 1.58; x2.5/x3 collapse the edge), and (2) COIN SELECTION as the stop-loss
 * replacement — only emit a BUY ("GOM") when `dcaScore` clears the survival gate
 * (market cap + weekly trend alive — see [[computeDcaScore]]; the gate lifts PF 1.58→3.53).
 *
 * This is deliberately stricter than the plain `dcaZone` GOM trigger (which only
 * looks at "RSI low near the 20-day low"): here GOM additionally requires a deep
 * drawdown from the cycle peak AND a tight sideways base AND the survival gate.
 */

export type AccZone = 'GOM' | 'CHO' | 'CHOT';

export type AccumulationConfig = {
  /** Min drawdown from peak (fraction, 0.40 = down 40%). */
  ddMin: number;
  /** Max drawdown from peak (fraction). */
  ddMax: number;
  /** Lookback (D1 candles) for the consolidation base. */
  baseLen: number;
  /** Max base width as a fraction ((high-low)/low) for "sideways". */
  baseMaxPct: number;
  /** Price must sit within this fraction above the base low to count as "in the base". */
  lowZonePct: number;
  /** D1 RSI(14) ceiling. */
  rsiMax: number;
  /** Weekly highs lookback (weeks) for the "peak" the drawdown is measured from. */
  peakWeeks: number;
  /** dcaScore survival gate — GOM only fires at/above this. */
  dcaGate: number;
};

export const DEFAULT_ACC_CONFIG: AccumulationConfig = {
  // dd band 50–85% is the backtested sweet spot (claude-backtest/runs/2026-07-12-bottom-dca-x2x3-merged):
  // shallower misses real bottoms, deeper (60–90%) is dominated by dying coins (PF 0.13).
  ddMin: 0.5,
  ddMax: 0.85,
  baseLen: 30,
  baseMaxPct: 0.25,
  lowZonePct: 0.08,
  rsiMax: 45,
  peakWeeks: 104,
  dcaGate: 50,
};

export type AccumulationParams = {
  /** D1 closes (oldest → newest). */
  closesD1: number[];
  /** D1 highs (parallel to closes). */
  highsD1: number[];
  /** D1 lows (parallel to closes). */
  lowsD1: number[];
  /** Weekly highs (oldest → newest) — used to find the cycle peak. */
  weeklyHighs: number[];
  /** Coin's DCA survival score (market cap + weekly trend). */
  dcaScore: number;
  /** Optional config overrides. */
  cfg?: Partial<AccumulationConfig>;
};

export type AccumulationSignal = {
  zone: AccZone;
  /** % below the peak, as a positive number (55 = price is 55% under peak). */
  drawdownPct: number | null;
  /** Consolidation base width %. */
  baseWidthPct: number | null;
  /** All structural accumulation conditions met (deep dd + sideways + lower base + RSI). */
  inBase: boolean;
  /** D1 RSI(14). */
  rsi: number | null;
  /** D1 close is back above EMA34 (the take-profit reclaim flag). */
  ema34Above: boolean;
  /** dcaScore cleared the survival gate. */
  gatePassed: boolean;
  /** Consolidation base low (D1) over the last `baseLen` candles — anchors the gom price plan. */
  baseLow: number | null;
  /** Short human-readable explanation (Vietnamese, for the dashboard). */
  reason: string;
};

/**
 * Suggested accumulation price plan derived from the consolidation base low.
 *
 * Turns the binary GOM signal into concrete levels: the entry band (base low →
 * base low + `lowZonePct`, where GOM actually triggers) and a 3-tier −15% ladder
 * matching the backtested bottom-DCA strategy
 * (claude-backtest/runs/2026-07-12-bottom-dca-x2x3-merged). Tranches are equal-USD,
 * so the average cost is the harmonic mean of the fill prices, and the take-profit
 * is a full exit at x2 (the PF 1.58 sweet spot).
 *
 * The −15% step is the strategy's fixed spacing, NOT a swept optimum — surface it as
 * a suggestion.
 */
export type DcaGomPlan = {
  /** Bottom of the entry band (base low). */
  zoneLow: number;
  /** Top of the entry band (base low × (1 + lowZonePct)) — the GOM trigger ceiling. */
  zoneHigh: number;
  /** Suggested limit prices [L1, L2, L3]; L1 = zoneHigh, each next tier −stepPct below. */
  ladder: number[];
  /** Average cost if all tiers fill with equal USD (harmonic mean of the ladder). */
  avgCost: number;
  /** Full-exit target = avgCost × 2 (+100%). */
  targetX2: number;
};

export type DcaGomPlanConfig = {
  /** Entry band width above the base low (fraction). Matches `AccumulationConfig.lowZonePct`. */
  lowZonePct: number;
  /** Ladder spacing between tiers (fraction below the previous tier). */
  stepPct: number;
  /** Number of ladder tiers. */
  tiers: number;
};

export const DEFAULT_GOM_PLAN_CONFIG: DcaGomPlanConfig = {
  lowZonePct: DEFAULT_ACC_CONFIG.lowZonePct,
  stepPct: 0.15,
  tiers: 3,
};

/** Build the suggested gom price plan from a consolidation base low. Returns null when baseLow is invalid. */
export function dcaGomPlan(baseLow: number | null, cfg: Partial<DcaGomPlanConfig> = {}): DcaGomPlan | null {
  if (baseLow == null || !(baseLow > 0)) return null;
  const { lowZonePct, stepPct, tiers } = { ...DEFAULT_GOM_PLAN_CONFIG, ...cfg };
  const zoneLow = baseLow;
  const zoneHigh = baseLow * (1 + lowZonePct);
  const ladder = Array.from({ length: tiers }, (_, i) => zoneHigh * (1 - stepPct) ** i);
  // Equal-USD tranches → average cost is the harmonic mean of the fill prices.
  const invSum = ladder.reduce((s, p) => s + 1 / p, 0);
  const avgCost = ladder.length / invSum;
  const round = (n: number) => Number(n.toFixed(8));
  return {
    zoneLow: round(zoneLow),
    zoneHigh: round(zoneHigh),
    ladder: ladder.map(round),
    avgCost: round(avgCost),
    targetX2: round(avgCost * 2),
  };
}

export function computeAccumulationSignal(p: AccumulationParams): AccumulationSignal | null {
  const cfg = { ...DEFAULT_ACC_CONFIG, ...(p.cfg ?? {}) };
  const closes = p.closesD1;
  if (closes.length < cfg.baseLen + 1 || closes.length < 35) return null;

  const lastClose = closes[closes.length - 1]!;
  const ema34Above = lastClose > calculateEma(closes, 34);
  const rsi = closes.length > 14 ? calculateRsi(closes, 14) : null;

  // ── peak (for drawdown) — prefer weekly highs over the cycle, fall back to D1 ──
  let peak = -Infinity;
  if (p.weeklyHighs.length > 0) {
    const start = Math.max(0, p.weeklyHighs.length - cfg.peakWeeks);
    for (let i = start; i < p.weeklyHighs.length; i++) if (p.weeklyHighs[i]! > peak) peak = p.weeklyHighs[i]!;
  } else {
    for (const h of p.highsD1) if (h > peak) peak = h;
  }
  const drawdownPct = peak > 0 && isFinite(peak) ? Number((((peak - lastClose) / peak) * 100).toFixed(1)) : null;

  // ── consolidation base over the last `baseLen` candles (excluding current) ──
  let rangeHigh = -Infinity;
  let rangeLow = Infinity;
  const from = Math.max(0, p.highsD1.length - cfg.baseLen - 1);
  for (let i = from; i < p.highsD1.length - 1; i++) {
    if (p.highsD1[i]! > rangeHigh) rangeHigh = p.highsD1[i]!;
    if (p.lowsD1[i]! < rangeLow) rangeLow = p.lowsD1[i]!;
  }
  const baseWidthPct = rangeLow > 0 && isFinite(rangeHigh)
    ? Number((((rangeHigh - rangeLow) / rangeLow) * 100).toFixed(1))
    : null;
  const inLowerBase = rangeLow > 0 && lastClose <= rangeLow * (1 + cfg.lowZonePct);

  const ddFrac = drawdownPct != null ? drawdownPct / 100 : 0;
  const ddOk = ddFrac >= cfg.ddMin && ddFrac <= cfg.ddMax;
  const sideways = baseWidthPct != null && baseWidthPct / 100 <= cfg.baseMaxPct;
  const rsiOk = rsi != null && rsi <= cfg.rsiMax;
  const gatePassed = p.dcaScore >= cfg.dcaGate;
  const inBase = ddOk && sideways && inLowerBase && rsiOk;

  let zone: AccZone;
  let reason: string;
  if (ema34Above) {
    zone = 'CHOT';
    reason = 'Giá đã hồi lên trên EMA34 → chốt / không gom';
  } else if (inBase && gatePassed) {
    zone = 'GOM';
    reason = `Vùng tích luỹ: -${drawdownPct}% từ đỉnh, base ${baseWidthPct}%, RSI ${rsi != null ? Math.round(rsi) : '—'}, dcaScore ${p.dcaScore} ✓`;
  } else if (inBase && !gatePassed) {
    zone = 'CHO';
    reason = `Đủ điều kiện tích luỹ nhưng dcaScore ${p.dcaScore} < ${cfg.dcaGate} (rủi ro sống còn) → chờ`;
  } else {
    zone = 'CHO';
    const why = !ddOk
      ? `drawdown ${drawdownPct ?? '—'}% ngoài ${cfg.ddMin * 100}-${cfg.ddMax * 100}%`
      : !sideways
        ? `base ${baseWidthPct ?? '—'}% chưa đi ngang`
        : !inLowerBase
          ? 'giá chưa về sát đáy base'
          : `RSI ${rsi != null ? Math.round(rsi) : '—'} > ${cfg.rsiMax}`;
    reason = `Chưa vào vùng tích luỹ (${why}) → chờ`;
  }

  const baseLow = rangeLow > 0 && isFinite(rangeLow) ? Number(rangeLow.toFixed(8)) : null;
  return { zone, drawdownPct, baseWidthPct, inBase, rsi, ema34Above, gatePassed, baseLow, reason };
}
