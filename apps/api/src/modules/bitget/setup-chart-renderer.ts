import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import type { ChartConfiguration, Plugin } from 'chart.js';
import { calculateQqe, type QqeCross } from '@app/core';

export type OhlcCandle = {
  time: number; // unix timestamp ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

/** A position annotation drawn as horizontal price line(s) on the chart. */
export type ChartMarker =
  | {
      kind: 'open';
      holdSide: 'long' | 'short';
      entryPrice: number;
      /** Live unrealized PnL (USDT) for the label, if known. */
      pnlUsd?: number;
    }
  | {
      kind: 'closed';
      holdSide: 'long' | 'short';
      entryPrice: number;
      closePrice: number;
      /** Realized net PnL (USDT) — sign drives the win/loss colour + label. */
      pnlUsd: number;
    };

export type SetupChartInput = {
  symbol: string;
  timeframe: string; // e.g. "M30"
  /** Full candle history — extra bars beyond `display` warm up the slow EMAs. */
  candles: OhlcCandle[];
  currentPrice: number;
  /** How many of the most recent candles to actually plot (default: all). */
  display?: number;
  /** Open / closed position markers to overlay as price lines. */
  markers?: ChartMarker[];
  /** For a reviewed closed trade: the candle indices (into the displayed slice)
   *  where the position opened and closed — draws vertical Vào/Đóng lines and a
   *  shaded holding band. */
  tradeSpan?: { openIndex: number; closeIndex: number; win: boolean };
};

// Widened 1.5× (1200 → 1800): the panes are ~square, so in the fullscreen dialog
// the image was height-constrained and left big side gaps on desktop. A more
// landscape canvas fills the horizontal space and de-crowds the candles.
const CANVAS_WIDTH = 1800;
// Two stacked bottom panes: RSI over Volume, each with a gap above it.
const RSI_PANE_HEIGHT = 150;
const VOL_PANE_HEIGHT = 120;
const PANE_GAP_TOP = 26; // price → RSI
const PANE_GAP_MID = 24; // RSI → Volume
const PANE_MARGIN_BOTTOM = 24;
const BOTTOM_RESERVED =
  PANE_GAP_TOP + RSI_PANE_HEIGHT + PANE_GAP_MID + VOL_PANE_HEIGHT + PANE_MARGIN_BOTTOM;
const CANVAS_HEIGHT = 800 + BOTTOM_RESERVED;

// ── Indicator math (all TradingView defaults) ───────────────────────────────

/** Standard EMA series aligned with the input (NaN until the period warms up). */
function emaSeries(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let ema = 0;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      out.push(NaN);
      continue;
    }
    if (i === period - 1) {
      ema = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
    } else {
      ema = values[i]! * k + ema * (1 - k);
    }
    out.push(ema);
  }
  return out;
}

/** Simple moving average aligned with the input (NaN until the period warms up). */
function smaSeries(values: number[], period: number): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    out.push(i >= period - 1 ? sum / period : NaN);
  }
  return out;
}

/** Wilder-smoothed RSI series (TradingView default: RSI 14). */
function rsiSeries(closes: number[], period = 14): number[] {
  const out: number[] = new Array(closes.length).fill(NaN);
  if (closes.length <= period) return out;

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d >= 0) gain += d;
    else loss += -d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

type EngulfKind = 'bull' | 'bear' | null;

/**
 * "Engulfing Candles Detector" (TradingView default config: 1 engulfed candle,
 * body-based). Bullish = a green candle whose real body fully engulfs the prior
 * red candle's body; bearish = a red candle whose body engulfs the prior green
 * body. Computed over the full history and later tailed to the display window.
 */
function detectEngulfing(candles: OhlcCandle[]): EngulfKind[] {
  const out: EngulfKind[] = new Array(candles.length).fill(null);
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const p = candles[i - 1]!;
    const curBull = c.close > c.open;
    const curBear = c.close < c.open;
    const prevBull = p.close > p.open;
    const prevBear = p.close < p.open;
    if (curBull && prevBear && c.close >= p.open && c.open <= p.close) {
      out[i] = 'bull';
    } else if (curBear && prevBull && c.close <= p.open && c.open >= p.close) {
      out[i] = 'bear';
    }
  }
  return out;
}

type SrChannel = { hi: number; lo: number; strength: number };

/**
 * Support/Resistance channels, ported from LonesomeTheBlue's "Support Resistance
 * Channels" (TradingView defaults: pivot period 10, channel width 5% of the
 * 290-bar range, up to 6 non-overlapping channels). Pivots that cluster within a
 * channel width are merged; strength = 20 per clustered pivot + 1 per touching bar.
 */
function computeSrChannels(
  candles: OhlcCandle[],
  { prd = 10, channelWPct = 5, maxSr = 6, minPivots = 2, loopback = 290 } = {},
): SrChannel[] {
  const n = candles.length;
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  const lbStart = Math.max(0, n - loopback);

  // Collect pivot highs & lows over ±prd bars, within the loopback window.
  const pivots: number[] = [];
  for (let i = Math.max(prd, lbStart); i < n - prd; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - prd; j <= i + prd; j++) {
      if (highs[j]! > highs[i]!) isHigh = false;
      if (lows[j]! < lows[i]!) isLow = false;
    }
    if (isHigh) pivots.push(highs[i]!);
    if (isLow) pivots.push(lows[i]!);
  }
  if (pivots.length === 0) return [];

  let hh = -Infinity;
  let ll = Infinity;
  for (let i = lbStart; i < n; i++) {
    hh = Math.max(hh, highs[i]!);
    ll = Math.min(ll, lows[i]!);
  }
  const cwidth = ((hh - ll) * channelWPct) / 100;

  // Build a candidate channel around each pivot and score it.
  const chans: SrChannel[] = pivots.map((seed) => {
    let lo = seed;
    let hi = seed;
    let count = 0;
    for (const cpp of pivots) {
      const wdth = cpp <= hi ? hi - cpp : cpp - lo;
      if (wdth <= cwidth) {
        if (cpp <= hi) lo = Math.min(lo, cpp);
        else hi = Math.max(hi, cpp);
        count += 1;
      }
    }
    let strength = count * 20;
    for (let i = lbStart; i < n; i++) {
      const h = highs[i]!;
      const l = lows[i]!;
      if ((h <= hi && h >= lo) || (l <= hi && l >= lo)) strength += 1;
    }
    return { hi, lo, strength, count } as SrChannel & { count: number };
  });

  // Strongest first, then keep non-overlapping channels up to the cap.
  chans.sort((a, b) => b.strength - a.strength);
  const selected: SrChannel[] = [];
  for (const ch of chans as (SrChannel & { count: number })[]) {
    if (ch.count < minPivots) continue;
    if (selected.some((s) => ch.hi >= s.lo && ch.lo <= s.hi)) continue;
    selected.push({ hi: ch.hi, lo: ch.lo, strength: ch.strength });
    if (selected.length >= maxSr) break;
  }
  return selected;
}

// ── Canvas plugins ──────────────────────────────────────────────────────────

/** Clips subsequent drawing to the price plot area so nothing bleeds into the
 *  RSI pane below (TradingView keeps price and oscillator panes fully separate). */
function clipToPriceArea(chart: Parameters<NonNullable<Plugin['beforeDatasetsDraw']>>[0]) {
  const { ctx, chartArea } = chart;
  ctx.beginPath();
  ctx.rect(
    chartArea.left,
    chartArea.top,
    chartArea.right - chartArea.left,
    chartArea.bottom - chartArea.top,
  );
  ctx.clip();
}

/** OHLC candlesticks drawn straight onto the canvas. Engulfing candles override
 *  the normal monochrome style with a solid colour (green bull / red bear) so the
 *  pattern reads straight off the candle — no separate marker needed. */
function candlestickPlugin(candles: OhlcCandle[], engulf: EngulfKind[]): Plugin {
  return {
    id: 'candlestick',
    beforeDatasetsDraw(chart) {
      const { ctx, scales } = chart;
      const xScale = scales['x'];
      const yScale = scales['y'];
      if (!xScale || !yScale) return;

      ctx.save();
      clipToPriceArea(chart);
      const barWidth = Math.max(2, (xScale.width / candles.length) * 0.6);
      candles.forEach((candle, i) => {
        const x = xScale.getPixelForValue(i);
        const openY = yScale.getPixelForValue(candle.open);
        const closeY = yScale.getPixelForValue(candle.close);
        const highY = yScale.getPixelForValue(candle.high);
        const lowY = yScale.getPixelForValue(candle.low);

        // Normal candles are monochrome (white body up / black body down, black
        // border + wick) so the coloured indicators (QQE/EMAs) stand out. An
        // Engulfing candle overrides that with a solid green (bull) / red (bear).
        const kind = engulf[i];
        let bodyFill: string;
        let outline: string;
        if (kind === 'bull') {
          bodyFill = '#26a69a';
          outline = '#0f766e';
        } else if (kind === 'bear') {
          bodyFill = '#ef5350';
          outline = '#b71c1c';
        } else {
          bodyFill = candle.close >= candle.open ? '#ffffff' : '#000000';
          outline = '#000000';
        }
        ctx.save();
        // Wick / shadow.
        ctx.strokeStyle = outline;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, highY);
        ctx.lineTo(x, lowY);
        ctx.stroke();
        // Body: filled with a matching border.
        const bodyTop = Math.min(openY, closeY);
        const bodyHeight = Math.max(1, Math.abs(closeY - openY));
        const bodyX = x - barWidth / 2;
        ctx.fillStyle = bodyFill;
        ctx.fillRect(bodyX, bodyTop, barWidth, bodyHeight);
        ctx.strokeStyle = outline;
        ctx.lineWidth = 1;
        ctx.strokeRect(bodyX, bodyTop, barWidth, bodyHeight);
        ctx.restore();
      });
      ctx.restore();
    },
  };
}

/**
 * colinmck "QQE Signals" markers on the price chart: a green ▲ "Long" label below
 * the candle where the QQE trailing line crosses under RSI-MA, a red ▼ "Short"
 * label above the candle where it crosses over. Clipped to the price area so the
 * labels never bleed into the RSI/Volume panes.
 */
function qqeSignalPlugin(candles: OhlcCandle[], cross: QqeCross[]): Plugin {
  return {
    id: 'qqe-signals',
    afterDatasetsDraw(chart) {
      const { ctx, scales } = chart;
      const xScale = scales['x'];
      const yScale = scales['y'];
      if (!xScale || !yScale) return;

      ctx.save();
      clipToPriceArea(chart);
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';

      cross.forEach((c, i) => {
        const candle = candles[i];
        if (!c || !candle) return;
        const x = xScale.getPixelForValue(i);

        if (c === 'long') {
          const tipY = yScale.getPixelForValue(candle.low) + 8;
          ctx.fillStyle = '#16a34a';
          ctx.beginPath();
          ctx.moveTo(x, tipY);
          ctx.lineTo(x - 5, tipY + 8);
          ctx.lineTo(x + 5, tipY + 8);
          ctx.closePath();
          ctx.fill();
          ctx.textBaseline = 'top';
          ctx.fillText('Long', x, tipY + 10);
        } else {
          const tipY = yScale.getPixelForValue(candle.high) - 8;
          ctx.fillStyle = '#dc2626';
          ctx.beginPath();
          ctx.moveTo(x, tipY);
          ctx.lineTo(x - 5, tipY - 8);
          ctx.lineTo(x + 5, tipY - 8);
          ctx.closePath();
          ctx.fill();
          ctx.textBaseline = 'bottom';
          ctx.fillText('Short', x, tipY - 10);
        }
      });
      ctx.restore();
    },
  };
}

/**
 * SonicR "Dragon": a translucent green ribbon between EMA34-of-high and
 * EMA34-of-low. The EMA34-close mid line and EMA89 trend line are drawn as
 * regular datasets so they show in the legend.
 */
function sonicDragonPlugin(ema34High: number[], ema34Low: number[]): Plugin {
  return {
    id: 'sonic-dragon',
    beforeDatasetsDraw(chart) {
      const { ctx, scales } = chart;
      const xScale = scales['x'];
      const yScale = scales['y'];
      if (!xScale || !yScale) return;

      ctx.save();
      clipToPriceArea(chart);
      ctx.fillStyle = 'rgba(56, 142, 60, 0.14)';
      ctx.beginPath();
      let started = false;
      // Top edge (EMA34 high) left→right.
      for (let i = 0; i < ema34High.length; i++) {
        const v = ema34High[i];
        if (v == null || Number.isNaN(v)) continue;
        const x = xScale.getPixelForValue(i);
        const y = yScale.getPixelForValue(v);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      }
      // Bottom edge (EMA34 low) right→left to close the band.
      for (let i = ema34Low.length - 1; i >= 0; i--) {
        const v = ema34Low[i];
        if (v == null || Number.isNaN(v)) continue;
        const x = xScale.getPixelForValue(i);
        const y = yScale.getPixelForValue(v);
        ctx.lineTo(x, y);
      }
      if (started) {
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    },
  };
}

/** Support/Resistance channels as horizontal bands, coloured by side of price. */
function srChannelPlugin(channels: SrChannel[], currentPrice: number): Plugin {
  return {
    id: 'sr-channel',
    beforeDatasetsDraw(chart) {
      const { ctx, scales } = chart;
      const xScale = scales['x'];
      const yScale = scales['y'];
      if (!xScale || !yScale) return;

      const left = xScale.left;
      const width = xScale.width;
      ctx.save();
      clipToPriceArea(chart);
      for (const ch of channels) {
        const yHi = yScale.getPixelForValue(ch.hi);
        const yLo = yScale.getPixelForValue(ch.lo);
        // Resistance (above price) red, support (below) green, straddling grey.
        const isResistance = ch.lo > currentPrice;
        const isSupport = ch.hi < currentPrice;
        const rgb = isResistance ? '239, 83, 80' : isSupport ? '38, 166, 154' : '100, 116, 139';
        ctx.fillStyle = `rgba(${rgb}, 0.10)`;
        ctx.fillRect(left, yHi, width, Math.max(1, yLo - yHi));
        ctx.strokeStyle = `rgba(${rgb}, 0.55)`;
        ctx.lineWidth = 1;
        ctx.strokeRect(left, yHi, width, Math.max(1, yLo - yHi));
      }
      ctx.restore();
    },
  };
}

/** RSI(14) oscillator pane below the price chart with 70/50/30 guides. */
function rsiPlugin(rsi: number[]): Plugin {
  return {
    id: 'rsi',
    afterDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      const xScale = scales['x'];
      if (!xScale) return;

      const left = xScale.left;
      const right = xScale.left + xScale.width;
      const bandTop = chartArea.bottom + PANE_GAP_TOP;
      const bandBottom = bandTop + RSI_PANE_HEIGHT;
      const bandH = bandBottom - bandTop;
      const yFor = (v: number) => bandBottom - (Math.max(0, Math.min(100, v)) / 100) * bandH;

      ctx.save();
      // Shaded oversold (<30) and overbought (>70) zones.
      ctx.fillStyle = 'rgba(38,166,154,0.07)';
      ctx.fillRect(left, yFor(30), right - left, bandBottom - yFor(30));
      ctx.fillStyle = 'rgba(239,83,80,0.07)';
      ctx.fillRect(left, bandTop, right - left, yFor(70) - bandTop);

      ctx.strokeStyle = 'rgba(15,23,42,0.15)';
      ctx.lineWidth = 1;
      ctx.strokeRect(left, bandTop, right - left, bandH);

      const guide = (val: number, color: string, dash: number[]) => {
        const y = yFor(val);
        ctx.beginPath();
        ctx.setLineDash(dash);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = color;
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(String(val), right - 4, y - 3);
      };
      guide(70, 'rgba(239,83,80,0.65)', [4, 3]);
      guide(50, 'rgba(100,116,139,0.4)', [2, 3]);
      guide(30, 'rgba(38,166,154,0.65)', [4, 3]);

      // RSI line (TradingView default purple).
      ctx.beginPath();
      ctx.strokeStyle = '#7e57c2';
      ctx.lineWidth = 1.6;
      let started = false;
      for (let i = 0; i < rsi.length; i++) {
        const v = rsi[i];
        if (v == null || Number.isNaN(v)) {
          started = false;
          continue;
        }
        const x = xScale.getPixelForValue(i);
        const y = yFor(v);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = '#7e57c2';
      ctx.fillText('RSI (14)', left + 6, bandTop + 14);
      ctx.restore();
    },
  };
}

/**
 * FxCanli Volume (Hacim) pane below the RSI: per-bar volume histogram coloured
 * by candle direction (green up / red down) plus a 20-period volume MA line.
 */
function volumePlugin(candles: OhlcCandle[], volMa: number[]): Plugin {
  return {
    id: 'volume',
    afterDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      const xScale = scales['x'];
      if (!xScale) return;

      const left = xScale.left;
      const right = xScale.left + xScale.width;
      const paneTop = chartArea.bottom + PANE_GAP_TOP + RSI_PANE_HEIGHT + PANE_GAP_MID;
      const paneBottom = paneTop + VOL_PANE_HEIGHT;
      const paneH = paneBottom - paneTop;

      const vols = candles.map((c) => c.volume ?? 0);
      const maxVol = Math.max(1, ...vols);
      const yFor = (v: number) => paneBottom - (Math.max(0, v) / maxVol) * paneH;
      const barWidth = Math.max(2, (xScale.width / candles.length) * 0.6);

      ctx.save();
      ctx.beginPath();
      ctx.rect(left, paneTop, right - left, paneH);
      ctx.clip();

      ctx.strokeStyle = 'rgba(15,23,42,0.15)';
      ctx.lineWidth = 1;
      ctx.strokeRect(left, paneTop, right - left, paneH);

      // Volume bars.
      candles.forEach((c, i) => {
        const up = c.close >= c.open;
        ctx.fillStyle = up ? 'rgba(38,166,154,0.55)' : 'rgba(239,83,80,0.55)';
        const x = xScale.getPixelForValue(i);
        const y = yFor(vols[i]!);
        ctx.fillRect(x - barWidth / 2, y, barWidth, paneBottom - y);
      });

      // Volume MA(20) line.
      ctx.beginPath();
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.6;
      let started = false;
      for (let i = 0; i < volMa.length; i++) {
        const v = volMa[i];
        if (v == null || Number.isNaN(v)) {
          started = false;
          continue;
        }
        const x = xScale.getPixelForValue(i);
        const y = yFor(v);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();

      // Title (outside the clip).
      ctx.save();
      ctx.textAlign = 'left';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = '#334155';
      ctx.fillText('FxCanli Volume (Hacim)', left + 6, paneTop + 14);
      ctx.fillStyle = '#f59e0b';
      ctx.fillText('MA20', left + 160, paneTop + 14);
      ctx.restore();
    },
  };
}

/** Adaptive price precision so both $64,000 and $0.0123 read cleanly in labels. */
function fmtPrice(n: number): string {
  const abs = Math.abs(n);
  const d = abs >= 1000 ? 1 : abs >= 1 ? 3 : abs >= 0.01 ? 5 : 8;
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

const fmtPnl = (v: number) => `${v >= 0 ? '+' : '−'}$${Math.abs(v).toFixed(2)}`;

/**
 * Draws position markers as horizontal price lines:
 *  • open   → one solid line at the entry (green LONG / red SHORT) + live uPnL;
 *  • closed → a grey dashed entry line + a win/loss-coloured dashed close line
 *             tagged "lãi"/"lỗ".
 */
function positionMarkerPlugin(markers: ChartMarker[]): Plugin {
  return {
    id: 'position-markers',
    afterDatasetsDraw(chart) {
      const { ctx, scales, chartArea } = chart;
      const yScale = scales['y'];
      if (!yScale || markers.length === 0) return;

      const left = chartArea.left;
      const right = chartArea.right;

      ctx.save();
      ctx.beginPath();
      ctx.rect(left, chartArea.top, right - left, chartArea.bottom - chartArea.top);
      ctx.clip();

      const drawLine = (price: number, color: string, dash: number[], label: string, above: boolean) => {
        const y = yScale.getPixelForValue(price);
        ctx.beginPath();
        ctx.setLineDash(dash);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.font = 'bold 11px sans-serif';
        const padX = 5;
        const tw = ctx.measureText(label).width;
        const boxH = 15;
        const bx = left + 6;
        const by = above ? y - boxH - 2 : y + 2;
        ctx.fillStyle = color;
        ctx.fillRect(bx, by, tw + padX * 2, boxH);
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, bx + padX, by + boxH / 2);
      };

      for (const m of markers) {
        const sideColor = m.holdSide === 'long' ? '#26a69a' : '#ef5350';
        const side = m.holdSide.toUpperCase();
        if (m.kind === 'open') {
          const pnl = m.pnlUsd != null ? ` · ${fmtPnl(m.pnlUsd)}` : '';
          drawLine(m.entryPrice, sideColor, [], `${side} vào ${fmtPrice(m.entryPrice)}${pnl}`, true);
        } else {
          drawLine(
            m.entryPrice,
            'rgba(100,116,139,0.95)',
            [5, 4],
            `${side} vào ${fmtPrice(m.entryPrice)}`,
            m.closePrice >= m.entryPrice,
          );
          const win = m.pnlUsd >= 0;
          drawLine(
            m.closePrice,
            win ? '#26a69a' : '#ef5350',
            [5, 4],
            `Đóng ${fmtPrice(m.closePrice)} · ${fmtPnl(m.pnlUsd)} (${win ? 'lãi' : 'lỗ'})`,
            m.closePrice < m.entryPrice,
          );
        }
      }
      ctx.restore();
    },
  };
}

/**
 * For a reviewed closed trade: a faint shaded band over the holding period plus
 * vertical "Vào"/"Đóng" lines at the open and close candles.
 */
function tradeSpanPlugin(span: NonNullable<SetupChartInput['tradeSpan']>): Plugin {
  return {
    id: 'trade-span',
    beforeDatasetsDraw(chart) {
      const { ctx, scales, chartArea } = chart;
      const xScale = scales['x'];
      if (!xScale) return;
      const top = chartArea.top;
      const bottom = chartArea.bottom;

      ctx.save();
      ctx.beginPath();
      ctx.rect(chartArea.left, top, chartArea.right - chartArea.left, bottom - top);
      ctx.clip();

      const xOpen = xScale.getPixelForValue(span.openIndex);
      const xClose = xScale.getPixelForValue(span.closeIndex);
      const closeColor = span.win ? '#26a69a' : '#ef5350';

      // Holding-period band.
      ctx.fillStyle = 'rgba(59, 130, 246, 0.06)';
      ctx.fillRect(xOpen, top, Math.max(1, xClose - xOpen), bottom - top);

      const vline = (x: number, color: string, label: string) => {
        ctx.beginPath();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.25;
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = 'bold 10px sans-serif';
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = color;
        ctx.fillRect(x - tw / 2 - 4, top + 2, tw + 8, 14);
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x, top + 9);
      };
      vline(xOpen, '#2563eb', 'Vào');
      vline(xClose, closeColor, 'Đóng');
      ctx.restore();
    },
  };
}

// ── Public entry ────────────────────────────────────────────────────────────

export async function renderSetupChart(input: SetupChartInput): Promise<Buffer> {
  const { candles: fullCandles, currentPrice, symbol, timeframe } = input;
  const markers = input.markers ?? [];

  // Compute indicators over the full history so the slow EMAs are warm, then
  // keep only the most recent `display` bars for plotting (like a TradingView
  // viewport that always has warmed-up MAs).
  const fullCloses = fullCandles.map((c) => c.close);
  const fullHighs = fullCandles.map((c) => c.high);
  const fullLows = fullCandles.map((c) => c.low);

  const display = Math.min(input.display ?? fullCandles.length, fullCandles.length);
  const start = fullCandles.length - display;
  const tail = <T>(arr: T[]) => arr.slice(start);

  const candles = tail(fullCandles);
  const ema34Close = tail(emaSeries(fullCloses, 34));
  const ema34High = tail(emaSeries(fullHighs, 34));
  const ema34Low = tail(emaSeries(fullLows, 34));
  const ema89 = tail(emaSeries(fullCloses, 89));
  const ema200 = tail(emaSeries(fullCloses, 200));
  const rsi = tail(rsiSeries(fullCloses, 14));
  const volMa = tail(smaSeries(fullCandles.map((c) => c.volume ?? 0), 20));
  // colinmck "QQE Signals" (14,5,4.238) — Long/Short crosses computed on full
  // history (warm bands) then tailed to the display window.
  const qqeCross = tail(calculateQqe(fullCloses).cross);
  // Engulfing Candles Detector — detected on full history, tailed to the window.
  const engulf = tail(detectEngulfing(fullCandles));
  const srChannels = computeSrChannels(candles);

  // Extra empty slots on the right so the most recent candle doesn't sit flush
  // against the price axis (TradingView-style breathing room). Candle/EMA/RSI
  // plugins only iterate real candle indices, so the pad stays blank; the
  // current-price line (built from `labels`) still reaches the axis.
  const RIGHT_PAD = 4;
  const labels = [
    ...candles.map((_, i) => i),
    ...Array.from({ length: RIGHT_PAD }, (_, k) => candles.length + k),
  ];
  const flatLine = (level: number) => labels.map(() => level);

  const config: ChartConfiguration = {
    type: 'line',
    data: {
      labels,
      datasets: [
        // Invisible placeholder to anchor the y-axis range.
        { label: '_range', data: [], borderWidth: 0, pointRadius: 0, hidden: true },
        {
          label: 'EMA34 (Dragon)',
          data: ema34Close,
          borderColor: '#2e7d32',
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
          tension: 0.1,
        },
        {
          label: 'EMA89 (SonicR)',
          data: ema89,
          borderColor: '#1565c0',
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
          tension: 0.1,
        },
        {
          label: 'EMA200',
          data: ema200,
          borderColor: '#ff6d00',
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
          tension: 0.1,
        },
        {
          label: 'Giá hiện tại',
          data: flatLine(currentPrice),
          borderColor: 'rgba(30, 41, 59, 0.55)',
          borderWidth: 1,
          borderDash: [4, 4],
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      responsive: false,
      animation: false,
      layout: { padding: { top: 40, right: 20, bottom: BOTTOM_RESERVED, left: 10 } },
      scales: {
        x: { display: false },
        y: {
          position: 'right',
          grid: { color: 'rgba(15,23,42,0.08)' },
          ticks: { color: '#475569', font: { size: 11 } },
        },
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: '#334155',
            font: { size: 11 },
            filter: (item) => item.text !== '_range',
          },
        },
        title: {
          display: true,
          text: `${symbol} ${timeframe} · SonicR + EMA200 + S/R Channel + RSI + QQE + Engulfing`,
          color: '#0f172a',
          font: { size: 14, weight: 'bold' },
        },
      },
    },
    plugins: [
      srChannelPlugin(srChannels, currentPrice),
      sonicDragonPlugin(ema34High, ema34Low),
      candlestickPlugin(candles, engulf),
      qqeSignalPlugin(candles, qqeCross),
      rsiPlugin(rsi),
      volumePlugin(candles, volMa),
      ...(input.tradeSpan ? [tradeSpanPlugin(input.tradeSpan)] : []),
      positionMarkerPlugin(markers),
    ],
  };

  // Anchor the y-axis to the visible price range (candles + EMAs + S/R zones).
  const emaVals = [...ema34High, ...ema34Low, ...ema89, ...ema200].filter((v) =>
    Number.isFinite(v),
  );
  const prices = [
    ...candles.flatMap((c) => [c.high, c.low]),
    ...emaVals,
    ...srChannels.flatMap((c) => [c.hi, c.lo]),
    ...markers.flatMap((m) => (m.kind === 'closed' ? [m.entryPrice, m.closePrice] : [m.entryPrice])),
    currentPrice,
  ];
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  // Pin the axis to the data range with a small margin (TradingView-style
  // breathing room) so the extreme wicks never sit flush against the pane edge.
  const pad = (maxPrice - minPrice) * 0.04 || maxPrice * 0.01;
  const yScaleOpts = config.options?.scales?.['y'];
  if (yScaleOpts) {
    (yScaleOpts as { min?: number; max?: number }).min = minPrice - pad;
    (yScaleOpts as { min?: number; max?: number }).max = maxPrice + pad;
  }

  const chartCanvas = new ChartJSNodeCanvas({
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    backgroundColour: '#ffffff',
  });
  return chartCanvas.renderToBuffer(config);
}
