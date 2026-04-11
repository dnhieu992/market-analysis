import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import type { ChartConfiguration, Plugin } from 'chart.js';
import type { ChartInput, ChartOutput } from './chart.types';

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 800;

function buildCandlestickPlugin(candles: ChartInput['candles']): Plugin {
  return {
    id: 'candlestick',
    beforeDatasetsDraw(chart) {
      const { ctx, scales } = chart;
      const xScale = scales['x'];
      const yScale = scales['y'];

      if (!xScale || !yScale) return;

      const barWidth = Math.max(2, (xScale.width / candles.length) * 0.6);

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
    }
  };
}

export async function renderChart(input: ChartInput): Promise<ChartOutput> {
  const { candles, ema20, ema50, ema200, supportLevels, resistanceLevels, currentPrice, symbol, timeframe } = input;

  const labels = candles.map((_, i) => i);

  const supportDatasets = supportLevels.map((level, i) => ({
    label: `S${i + 1}`,
    data: labels.map(() => level),
    borderColor: 'rgba(38, 166, 154, 0.7)',
    borderWidth: 1,
    borderDash: [6, 3],
    pointRadius: 0,
    fill: false,
    type: 'line' as const
  }));

  const resistanceDatasets = resistanceLevels.map((level, i) => ({
    label: `R${i + 1}`,
    data: labels.map(() => level),
    borderColor: 'rgba(239, 83, 80, 0.7)',
    borderWidth: 1,
    borderDash: [6, 3],
    pointRadius: 0,
    fill: false,
    type: 'line' as const
  }));

  const config: ChartConfiguration = {
    type: 'line',
    data: {
      labels,
      datasets: [
        // Invisible placeholder dataset to set y-axis range from candle prices
        {
          label: '_range',
          data: candles.flatMap(c => [c.high, c.low]).reduce<{ min: number; max: number }>(
            (acc, v) => ({ min: Math.min(acc.min, v), max: Math.max(acc.max, v) }),
            { min: Infinity, max: -Infinity }
          ) as unknown as number[],
          borderWidth: 0,
          pointRadius: 0,
          hidden: true
        },
        {
          label: 'EMA20',
          data: ema20,
          borderColor: '#2196f3',
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
          tension: 0.1
        },
        {
          label: 'EMA50',
          data: ema50,
          borderColor: '#ff9800',
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
          tension: 0.1
        },
        {
          label: 'EMA200',
          data: ema200,
          borderColor: '#f44336',
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
          tension: 0.1
        },
        {
          label: 'Price',
          data: labels.map(() => currentPrice),
          borderColor: 'rgba(255, 235, 59, 0.8)',
          borderWidth: 1,
          borderDash: [4, 4],
          pointRadius: 0,
          fill: false
        },
        ...supportDatasets,
        ...resistanceDatasets
      ]
    },
    options: {
      responsive: false,
      animation: false,
      layout: {
        padding: { top: 40, right: 20, bottom: 20, left: 10 }
      },
      scales: {
        x: {
          display: false
        },
        y: {
          position: 'right',
          grid: {
            color: 'rgba(255,255,255,0.05)'
          },
          ticks: {
            color: '#aaa',
            font: { size: 11 }
          }
        }
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: '#ccc',
            font: { size: 11 },
            filter: item => item.text !== '_range'
          }
        },
        title: {
          display: true,
          text: `${symbol} ${timeframe}`,
          color: '#eee',
          font: { size: 14, weight: 'bold' }
        }
      }
    },
    plugins: [buildCandlestickPlugin(candles)]
  };

  // Fix the hidden range dataset — provide actual min/max as two data points
  const prices = candles.flatMap(c => [c.high, c.low]);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const rangeDataset = config.data.datasets[0];
  if (rangeDataset) {
    rangeDataset.data = labels.map(i =>
      i === 0 ? minPrice : i === labels.length - 1 ? maxPrice : null as unknown as number
    );
  }

  const chartCanvas = new ChartJSNodeCanvas({
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    backgroundColour: '#1a1a2e'
  });

  const imageBuffer = await chartCanvas.renderToBuffer(config);

  return { imageBuffer, mimeType: 'image/png' };
}
