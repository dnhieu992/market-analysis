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
  /** Optional planned entry price — drawn as a dashed yellow line. */
  entryPrice?: number | null;
  /** Optional take-profit price — drawn as a dashed green line. */
  tpPrice?: number | null;
  /** Optional index of the candle that satisfied the setup — highlighted. */
  focusIndex?: number | null;
};

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 800;

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
        ctx.fillStyle = 'rgba(255, 235, 59, 0.10)';
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

export async function renderEmaBounceChart(input: EmaBounceChartInput): Promise<Buffer> {
  const {
    candles, ema34, ema89, ema200, supportLevels, resistanceLevels,
    currentPrice, entryPrice, tpPrice, symbol, timeframe, focusIndex = null,
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
          borderColor: 'rgba(255, 255, 255, 0.5)',
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
        padding: { top: 40, right: 20, bottom: 20, left: 10 },
      },
      scales: {
        x: {
          display: false,
        },
        y: {
          position: 'right',
          grid: {
            color: 'rgba(255,255,255,0.05)',
          },
          ticks: {
            color: '#aaa',
            font: { size: 11 },
          },
        },
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: '#ccc',
            font: { size: 11 },
            filter: (item) => item.text !== '_range',
          },
        },
        title: {
          display: true,
          text: `${symbol} ${timeframe}`,
          color: '#eee',
          font: { size: 14, weight: 'bold' },
        },
      },
    },
    plugins: [buildCandlestickPlugin(candles, focusIndex)],
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
    backgroundColour: '#1a1a2e',
  });

  return chartCanvas.renderToBuffer(config);
}
