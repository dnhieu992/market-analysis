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
  /** Optional planned entry price — drawn as a dashed yellow line. */
  entryPrice?: number | null;
  /** Optional take-profit price — drawn as a dashed green line. */
  tpPrice?: number | null;
  /** Optional index of the candle that satisfied the setup — highlighted. */
  focusIndex?: number | null;
};

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 980;
// Height reserved at the bottom for the StochRSI oscillator pane.
const STOCH_PANE_HEIGHT = 180;

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

/**
 * Draws a StochRSI oscillator pane in the reserved band below the price chart:
 * %K (blue) / %D (orange) lines, 20/80 oversold-overbought guides + shaded zones.
 */
function buildStochRsiPlugin(stochK: number[], stochD: number[]): Plugin {
  return {
    id: 'stochrsi',
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

      // Shaded oversold (<20) and overbought (>80) zones.
      ctx.fillStyle = 'rgba(38,166,154,0.07)';
      ctx.fillRect(left, yFor(20), right - left, bandBottom - yFor(20));
      ctx.fillStyle = 'rgba(239,83,80,0.07)';
      ctx.fillRect(left, bandTop, right - left, yFor(80) - bandTop);

      // Panel border.
      ctx.strokeStyle = 'rgba(15,23,42,0.15)';
      ctx.lineWidth = 1;
      ctx.strokeRect(left, bandTop, right - left, bandH);

      // Guide lines at 80 / 50 / 20 with right-edge labels.
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
      guide(80, 'rgba(239,83,80,0.65)', [4, 3]);
      guide(50, 'rgba(100,116,139,0.4)', [2, 3]);
      guide(20, 'rgba(38,166,154,0.65)', [4, 3]);

      // %D (slow) then %K (fast) on top.
      const drawLine = (arr: number[], color: string) => {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.6;
        let started = false;
        for (let i = 0; i < arr.length; i++) {
          const v = arr[i];
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
      };
      drawLine(stochD, '#f59e0b');
      drawLine(stochK, '#2563eb');

      // Title + inline legend.
      ctx.textAlign = 'left';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = '#334155';
      ctx.fillText('StochRSI (14,14,3,3)', left + 6, bandTop + 14);
      ctx.fillStyle = '#2563eb';
      ctx.fillText('%K', left + 150, bandTop + 14);
      ctx.fillStyle = '#f59e0b';
      ctx.fillText('%D', left + 180, bandTop + 14);

      ctx.restore();
    },
  };
}

export async function renderEmaBounceChart(input: EmaBounceChartInput): Promise<Buffer> {
  const {
    candles, ema34, ema89, ema200, supportLevels, resistanceLevels,
    currentPrice, stochK, stochD, entryPrice, tpPrice, symbol, timeframe, focusIndex = null,
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
        // Reserve the bottom band for the StochRSI pane drawn by its plugin.
        padding: { top: 40, right: 20, bottom: STOCH_PANE_HEIGHT + 30, left: 10 },
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
    plugins: [buildCandlestickPlugin(candles, focusIndex), buildStochRsiPlugin(stochK, stochD)],
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
