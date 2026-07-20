import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import type { ChartConfiguration, Plugin } from 'chart.js';

export type OhlcCandle = {
  time: number; // unix timestamp ms
  open: number;
  high: number;
  low: number;
  close: number;
};

export type SetupChartInput = {
  symbol: string;
  timeframe: string; // e.g. "M30"
  /** Full candle history — extra bars beyond `display` warm up the slow EMAs. */
  candles: OhlcCandle[];
  currentPrice: number;
  /** How many of the most recent candles to actually plot (default: all). */
  display?: number;
};

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 980;
// Height reserved at the bottom for the RSI oscillator pane.
const RSI_PANE_HEIGHT = 180;

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

/** OHLC candlesticks drawn straight onto the canvas. */
function candlestickPlugin(candles: OhlcCandle[]): Plugin {
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

        const color = candle.close >= candle.open ? '#26a69a' : '#ef5350';
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, highY);
        ctx.lineTo(x, lowY);
        ctx.stroke();
        const bodyTop = Math.min(openY, closeY);
        const bodyHeight = Math.max(1, Math.abs(closeY - openY));
        ctx.fillRect(x - barWidth / 2, bodyTop, barWidth, bodyHeight);
        ctx.restore();
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
      const bandTop = chartArea.bottom + 26;
      const bandBottom = chart.height - 28;
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

// ── Public entry ────────────────────────────────────────────────────────────

export async function renderSetupChart(input: SetupChartInput): Promise<Buffer> {
  const { candles: fullCandles, currentPrice, symbol, timeframe } = input;

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
  const rsi = tail(rsiSeries(fullCloses, 14));
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
      layout: { padding: { top: 40, right: 20, bottom: RSI_PANE_HEIGHT + 30, left: 10 } },
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
          text: `${symbol} ${timeframe} · SonicR + S/R Channel + RSI`,
          color: '#0f172a',
          font: { size: 14, weight: 'bold' },
        },
      },
    },
    plugins: [
      srChannelPlugin(srChannels, currentPrice),
      sonicDragonPlugin(ema34High, ema34Low),
      candlestickPlugin(candles),
      rsiPlugin(rsi),
    ],
  };

  // Anchor the y-axis to the visible price range (candles + EMAs + S/R zones).
  const emaVals = [...ema34High, ...ema34Low, ...ema89].filter((v) => Number.isFinite(v));
  const prices = [
    ...candles.flatMap((c) => [c.high, c.low]),
    ...emaVals,
    ...srChannels.flatMap((c) => [c.hi, c.lo]),
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
