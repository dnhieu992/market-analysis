import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import type { ChartConfiguration, Plugin } from 'chart.js';

export type OhlcCandle = {
  time: number; // unix timestamp ms
  open: number;
  high: number;
  low: number;
  close: number;
};

export type EmaBounceChartInput = {
  symbol: string;
  timeframe: string;
  candles: OhlcCandle[];
  ema34: number[]; // per-candle series, aligned with candles[]
  ema89: number[];
  ema200: number[];
  supportLevels: number[];
  resistanceLevels: number[];
  currentPrice: number;
  /** StochRSI %K / %D series (0–100), aligned with candles[] — drawn in a pane below price. */
  stochK: number[];
  stochD: number[];
  /** QQE fast (smoothed RSI) + signal (trailing) series (0–100), aligned with candles[] — drawn in a pane below StochRSI. */
  qqeRsiMa: number[];
  qqeSignal: number[];
  /** Optional planned entry price — drawn as a dashed yellow line. */
  entryPrice?: number | null;
  /** Optional take-profit price — drawn as a dashed green line. */
  tpPrice?: number | null;
  /** Optional index of the candle that satisfied the setup — highlighted. */
  focusIndex?: number | null;
};

const CANVAS_WIDTH = 1200;
// Height reserved at the bottom for each oscillator pane + the gap above it.
const STOCH_PANE_HEIGHT = 160;
const QQE_PANE_HEIGHT = 160;
const PANE_GAP = 26;
// Total bottom reserve: price↕gap, StochRSI pane, gap, QQE pane, + a small tail.
const PANES_RESERVE = PANE_GAP + STOCH_PANE_HEIGHT + PANE_GAP + QQE_PANE_HEIGHT + 20;
const CANVAS_HEIGHT = 820 + PANES_RESERVE;

/**
 * Draws OHLC candlesticks and, when a focus candle is given, a faint vertical
 * band highlighting the candle where the setup was satisfied.
 */
function buildCandlestickPlugin(
  candles: EmaBounceChartInput['candles'],
  focusIndex: number | null,
): Plugin {
  return {
    id: 'candlestick',
    beforeDatasetsDraw(chart) {
      const { ctx, scales } = chart;
      const xScale = scales['x'];
      const yScale = scales['y'];

      if (!xScale || !yScale) return;

      const barWidth = Math.max(2, (xScale.width / candles.length) * 0.6);

      // Highlight band around the trigger candle.
      if (focusIndex != null && focusIndex >= 0 && focusIndex < candles.length) {
        const fx = xScale.getPixelForValue(focusIndex);
        ctx.save();
        ctx.fillStyle = 'rgba(59, 130, 246, 0.12)';
        ctx.fillRect(fx - barWidth, yScale.top, barWidth * 2, yScale.bottom - yScale.top);
        ctx.restore();
      }

      candles.forEach((candle, i) => {
        const x = xScale.getPixelForValue(i);
        const openY = yScale.getPixelForValue(candle.open);
        const closeY = yScale.getPixelForValue(candle.close);
        const highY = yScale.getPixelForValue(candle.high);
        const lowY = yScale.getPixelForValue(candle.low);

        const isBullish = candle.close >= candle.open;
        const color = isBullish ? '#26a69a' : '#ef5350';

        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1;

        // Wick
        ctx.beginPath();
        ctx.moveTo(x, highY);
        ctx.lineTo(x, lowY);
        ctx.stroke();

        // Body
        const bodyTop = Math.min(openY, closeY);
        const bodyHeight = Math.max(1, Math.abs(closeY - openY));
        ctx.fillRect(x - barWidth / 2, bodyTop, barWidth, bodyHeight);

        ctx.restore();
      });
    },
  };
}

/** A single 0–100 oscillator line to plot inside a pane. */
type PaneLine = { data: number[]; color: string; width?: number };
/** A horizontal guide level with a right-edge label. */
type PaneGuide = { value: number; color: string; dash: number[] };
/** A shaded 0–100 band [from,to] filled across the pane width. */
type PaneZone = { from: number; to: number; color: string };

/**
 * Draws one stacked oscillator pane below the price chart. Panes are placed by
 * `topOffset` (pixels below chartArea.bottom) so several can be stacked, each on
 * its own fixed-height 0–100 scale.
 */
function buildOscillatorPane(opts: {
  id: string;
  topOffset: number;
  height: number;
  title: string;
  legend: Array<{ text: string; color: string }>;
  guides: PaneGuide[];
  zones: PaneZone[];
  lines: PaneLine[];
}): Plugin {
  return {
    id: opts.id,
    afterDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      const xScale = scales['x'];
      if (!xScale) return;

      const left = xScale.left;
      const right = xScale.left + xScale.width;
      const bandTop = chartArea.bottom + opts.topOffset;
      const bandBottom = bandTop + opts.height;
      const bandH = bandBottom - bandTop;
      const yFor = (v: number) => bandBottom - (Math.max(0, Math.min(100, v)) / 100) * bandH;

      ctx.save();

      // Shaded zones.
      for (const z of opts.zones) {
        const yTop = yFor(Math.max(z.from, z.to));
        const yBot = yFor(Math.min(z.from, z.to));
        ctx.fillStyle = z.color;
        ctx.fillRect(left, yTop, right - left, yBot - yTop);
      }

      // Panel border.
      ctx.strokeStyle = 'rgba(15,23,42,0.15)';
      ctx.lineWidth = 1;
      ctx.strokeRect(left, bandTop, right - left, bandH);

      // Guide lines with right-edge labels.
      for (const g of opts.guides) {
        const y = yFor(g.value);
        ctx.beginPath();
        ctx.setLineDash(g.dash);
        ctx.strokeStyle = g.color;
        ctx.lineWidth = 1;
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = g.color;
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(String(g.value), right - 4, y - 3);
      }

      // Oscillator lines (drawn in order; last on top).
      for (const line of opts.lines) {
        ctx.beginPath();
        ctx.strokeStyle = line.color;
        ctx.lineWidth = line.width ?? 1.6;
        let started = false;
        for (let i = 0; i < line.data.length; i++) {
          const v = line.data[i];
          if (v == null || Number.isNaN(v)) {
            started = false;
            continue;
          }
          const x = xScale.getPixelForValue(i);
          const y = yFor(v);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      }

      // Title + inline legend.
      ctx.textAlign = 'left';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = '#334155';
      ctx.fillText(opts.title, left + 6, bandTop + 14);
      let lx = left + 6 + ctx.measureText(opts.title).width + 14;
      for (const item of opts.legend) {
        ctx.fillStyle = item.color;
        ctx.fillText(item.text, lx, bandTop + 14);
        lx += ctx.measureText(item.text).width + 12;
      }

      ctx.restore();
    },
  };
}

/**
 * StochRSI oscillator pane: %K (blue) / %D (orange) lines, 20/80
 * oversold-overbought guides + shaded zones.
 */
function buildStochRsiPlugin(stochK: number[], stochD: number[]): Plugin {
  return buildOscillatorPane({
    id: 'stochrsi',
    topOffset: PANE_GAP,
    height: STOCH_PANE_HEIGHT,
    title: 'StochRSI (14,14,3,3)',
    legend: [
      { text: '%K', color: '#2563eb' },
      { text: '%D', color: '#f59e0b' },
    ],
    zones: [
      { from: 0, to: 20, color: 'rgba(38,166,154,0.07)' },
      { from: 80, to: 100, color: 'rgba(239,83,80,0.07)' },
    ],
    guides: [
      { value: 80, color: 'rgba(239,83,80,0.65)', dash: [4, 3] },
      { value: 50, color: 'rgba(100,116,139,0.4)', dash: [2, 3] },
      { value: 20, color: 'rgba(38,166,154,0.65)', dash: [4, 3] },
    ],
    // %D (slow) first, %K (fast) on top.
    lines: [
      { data: stochD, color: '#f59e0b' },
      { data: stochK, color: '#2563eb' },
    ],
  });
}

/**
 * QQE oscillator pane (below StochRSI): the smoothed-RSI fast line (purple) and
 * the trailing "QQE signal" line (teal). rsiMa crossing above the signal is bullish,
 * below is bearish. 50 mid-line guide.
 */
function buildQqePlugin(qqeRsiMa: number[], qqeSignal: number[]): Plugin {
  return buildOscillatorPane({
    id: 'qqe',
    topOffset: PANE_GAP + STOCH_PANE_HEIGHT + PANE_GAP,
    height: QQE_PANE_HEIGHT,
    title: 'QQE (14,5,4.236)',
    legend: [
      { text: 'RSI-MA', color: '#7c3aed' },
      { text: 'Signal', color: '#0d9488' },
    ],
    zones: [],
    guides: [{ value: 50, color: 'rgba(100,116,139,0.45)', dash: [2, 3] }],
    // Signal (trailing) first, fast RSI-MA on top.
    lines: [
      { data: qqeSignal, color: '#0d9488', width: 1.4 },
      { data: qqeRsiMa, color: '#7c3aed', width: 1.8 },
    ],
  });
}

export async function renderEmaBounceChart(input: EmaBounceChartInput): Promise<Buffer> {
  const {
    candles, ema34, ema89, ema200, supportLevels, resistanceLevels,
    currentPrice, stochK, stochD, qqeRsiMa, qqeSignal, entryPrice, tpPrice, symbol, timeframe, focusIndex = null,
  } = input;

  const labels = candles.map((_, i) => i);
  const flatLine = (level: number) => labels.map(() => level);

  const supportDatasets = supportLevels.map((level, i) => ({
    label: `S${i + 1}`,
    data: flatLine(level),
    borderColor: 'rgba(38, 166, 154, 0.7)',
    borderWidth: 1,
    borderDash: [6, 3],
    pointRadius: 0,
    fill: false,
    type: 'line' as const,
  }));

  const resistanceDatasets = resistanceLevels.map((level, i) => ({
    label: `R${i + 1}`,
    data: flatLine(level),
    borderColor: 'rgba(239, 83, 80, 0.7)',
    borderWidth: 1,
    borderDash: [6, 3],
    pointRadius: 0,
    fill: false,
    type: 'line' as const,
  }));

  const planDatasets = [];
  if (entryPrice != null && Number.isFinite(entryPrice)) {
    planDatasets.push({
      label: 'Entry',
      data: flatLine(entryPrice),
      borderColor: 'rgba(255, 235, 59, 0.9)',
      borderWidth: 1.5,
      borderDash: [2, 2],
      pointRadius: 0,
      fill: false,
      type: 'line' as const,
    });
  }
  if (tpPrice != null && Number.isFinite(tpPrice)) {
    planDatasets.push({
      label: 'TP +10%',
      data: flatLine(tpPrice),
      borderColor: 'rgba(38, 166, 154, 0.95)',
      borderWidth: 1.5,
      borderDash: [8, 4],
      pointRadius: 0,
      fill: false,
      type: 'line' as const,
    });
  }

  const config: ChartConfiguration = {
    type: 'line',
    data: {
      labels,
      datasets: [
        // Invisible placeholder dataset to anchor the y-axis range.
        {
          label: '_range',
          data: [],
          borderWidth: 0,
          pointRadius: 0,
          hidden: true,
        },
        {
          label: 'EMA34',
          data: ema34,
          borderColor: '#2196f3',
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
          tension: 0.1,
        },
        {
          label: 'EMA89',
          data: ema89,
          borderColor: '#ff9800',
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
          tension: 0.1,
        },
        {
          label: 'EMA200',
          data: ema200,
          borderColor: '#f44336',
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
        ...planDatasets,
        ...supportDatasets,
        ...resistanceDatasets,
      ],
    },
    options: {
      responsive: false,
      animation: false,
      layout: {
        // Reserve the bottom band for the StochRSI + QQE panes drawn by their plugins.
        padding: { top: 40, right: 20, bottom: PANES_RESERVE, left: 10 },
      },
      scales: {
        x: {
          display: false,
        },
        y: {
          position: 'right',
          grid: {
            color: 'rgba(15,23,42,0.08)',
          },
          ticks: {
            color: '#475569',
            font: { size: 11 },
          },
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
          text: `${symbol} ${timeframe}`,
          color: '#0f172a',
          font: { size: 14, weight: 'bold' },
        },
      },
    },
    plugins: [
      buildCandlestickPlugin(candles, focusIndex),
      buildStochRsiPlugin(stochK, stochD),
      buildQqePlugin(qqeRsiMa, qqeSignal),
    ],
  };

  // Anchor the y-axis to the visible price range (candles + EMAs + plan lines).
  const emaVals = [...ema34, ...ema89, ...ema200].filter((v) => Number.isFinite(v));
  const prices = [
    ...candles.flatMap((c) => [c.high, c.low]),
    ...emaVals,
    ...(entryPrice != null && Number.isFinite(entryPrice) ? [entryPrice] : []),
    ...(tpPrice != null && Number.isFinite(tpPrice) ? [tpPrice] : []),
  ];
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const rangeDataset = config.data.datasets[0];
  if (rangeDataset) {
    rangeDataset.data = labels.map((i) =>
      i === 0 ? minPrice : i === labels.length - 1 ? maxPrice : (null as unknown as number),
    );
  }

  const chartCanvas = new ChartJSNodeCanvas({
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    backgroundColour: '#ffffff',
  });

  return chartCanvas.renderToBuffer(config);
}
