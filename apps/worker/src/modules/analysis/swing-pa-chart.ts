import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import type { ChartConfiguration, Plugin } from 'chart.js';
import type { Candle } from '@app/core';

import type { SwingPaAnalysis, SRZone, FibLevel } from './swing-pa-analyzer';

const CANVAS_WIDTH  = 1200;
const CANVAS_HEIGHT = 700;

// ── Candlestick plugin ────────────────────────────────────────────────────────

type OhlcSlice = { open: number; high: number; low: number; close: number };

function candlestickPlugin(candles: OhlcSlice[]): Plugin {
  return {
    id: 'paCandles',
    beforeDatasetsDraw(chart) {
      const { ctx, scales } = chart;
      const xScale = scales['x'];
      const yScale = scales['y'];
      if (!xScale || !yScale) return;

      const barWidth = Math.max(2, (xScale.width / candles.length) * 0.65);

      candles.forEach((c, i) => {
        const x      = xScale.getPixelForValue(i);
        const openY  = yScale.getPixelForValue(c.open);
        const closeY = yScale.getPixelForValue(c.close);
        const highY  = yScale.getPixelForValue(c.high);
        const lowY   = yScale.getPixelForValue(c.low);

        const bull  = c.close >= c.open;
        const color = bull ? '#26a69a' : '#ef5350';

        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle   = color;
        ctx.lineWidth   = 1;

        // Wick
        ctx.beginPath();
        ctx.moveTo(x, highY);
        ctx.lineTo(x, lowY);
        ctx.stroke();

        // Body
        const bodyTop    = Math.min(openY, closeY);
        const bodyHeight = Math.max(1, Math.abs(closeY - openY));
        ctx.fillRect(x - barWidth / 2, bodyTop, barWidth, bodyHeight);
        ctx.restore();
      });
    }
  };
}

// ── S/R zone band plugin ──────────────────────────────────────────────────────

function zoneBandsPlugin(zones: SRZone[]): Plugin {
  return {
    id: 'paZones',
    beforeDatasetsDraw(chart) {
      const { ctx, scales, chartArea } = chart;
      const yScale = scales['y'];
      if (!yScale || !chartArea) return;

      for (const zone of zones) {
        const yTop    = yScale.getPixelForValue(zone.high);
        const yBot    = yScale.getPixelForValue(zone.low);
        const yMid    = yScale.getPixelForValue(zone.midpoint);
        const height  = Math.abs(yBot - yTop);

        ctx.save();

        if (zone.role === 'resistance') {
          ctx.fillStyle   = 'rgba(239, 83, 80, 0.10)';
          ctx.strokeStyle = 'rgba(239, 83, 80, 0.55)';
        } else {
          ctx.fillStyle   = 'rgba(38, 166, 154, 0.10)';
          ctx.strokeStyle = 'rgba(38, 166, 154, 0.55)';
        }

        // Filled band
        ctx.fillRect(chartArea.left, Math.min(yTop, yBot), chartArea.width, height);

        // Midpoint dashed line
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(chartArea.left,  yMid);
        ctx.lineTo(chartArea.right, yMid);
        ctx.stroke();

        // Zone label on right side
        ctx.setLineDash([]);
        ctx.font      = 'bold 10px sans-serif';
        ctx.fillStyle = zone.role === 'resistance' ? 'rgba(239,83,80,0.9)' : 'rgba(38,166,154,0.9)';
        const label   = `${zone.role === 'resistance' ? 'R' : 'S'} (${zone.touches}x)`;
        ctx.fillText(label, chartArea.right - 52, yMid - 3);

        ctx.restore();
      }
    }
  };
}

// ── Swing point marker plugin ─────────────────────────────────────────────────

function swingMarkersPlugin(
  candles: OhlcSlice[],
  swingHighPrices: Set<number>,
  swingLowPrices: Set<number>
): Plugin {
  const MARKER_OFFSET = 8;
  const MARKER_SIZE   = 5;

  return {
    id: 'paSwings',
    afterDatasetsDraw(chart) {
      const { ctx, scales } = chart;
      const xScale = scales['x'];
      const yScale = scales['y'];
      if (!xScale || !yScale) return;

      candles.forEach((c, i) => {
        const x = xScale.getPixelForValue(i);

        // Swing high — red triangle above wick
        if (swingHighPrices.has(c.high)) {
          const y = yScale.getPixelForValue(c.high) - MARKER_OFFSET;
          ctx.save();
          ctx.fillStyle = 'rgba(239, 83, 80, 0.9)';
          ctx.beginPath();
          ctx.moveTo(x, y - MARKER_SIZE);
          ctx.lineTo(x - MARKER_SIZE, y + MARKER_SIZE);
          ctx.lineTo(x + MARKER_SIZE, y + MARKER_SIZE);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }

        // Swing low — green triangle below wick (pointing up)
        if (swingLowPrices.has(c.low)) {
          const y = yScale.getPixelForValue(c.low) + MARKER_OFFSET;
          ctx.save();
          ctx.fillStyle = 'rgba(38, 166, 154, 0.9)';
          ctx.beginPath();
          ctx.moveTo(x, y + MARKER_SIZE);
          ctx.lineTo(x - MARKER_SIZE, y - MARKER_SIZE);
          ctx.lineTo(x + MARKER_SIZE, y - MARKER_SIZE);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      });
    }
  };
}

// ── Fibonacci retracement / extension plugin ──────────────────────────────────

const FIB_COLORS: Record<number, string> = {
  0.236: 'rgba(255,235,59,0.50)',
  0.382: 'rgba(255,235,59,0.75)',
  0.500: 'rgba(255,152,0,0.80)',
  0.618: 'rgba(255,87,34,0.95)',  // golden ratio
  0.786: 'rgba(255,235,59,0.55)',
  1.272: 'rgba(186,104,200,0.65)',
  1.618: 'rgba(186,104,200,0.90)',
};

function fibonacciPlugin(levels: FibLevel[]): Plugin {
  return {
    id: 'paFib',
    beforeDatasetsDraw(chart) {
      const { ctx, scales, chartArea } = chart;
      const yScale = scales['y'];
      if (!yScale || !chartArea || levels.length === 0) return;

      for (const level of levels) {
        const y     = yScale.getPixelForValue(level.price);
        if (y < chartArea.top || y > chartArea.bottom) continue;

        const color = FIB_COLORS[level.ratio] ?? 'rgba(255,255,255,0.4)';
        const dashed = level.type === 'retracement';

        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth   = 1;
        ctx.setLineDash(dashed ? [4, 3] : [8, 3]);
        ctx.beginPath();
        ctx.moveTo(chartArea.left,  y);
        ctx.lineTo(chartArea.right, y);
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.font      = '9px sans-serif';
        ctx.fillStyle = color;
        ctx.fillText(`Fib ${level.ratio}`, chartArea.left + 4, y - 3);
        ctx.restore();
      }
    }
  };
}

// ── Date label helper ─────────────────────────────────────────────────────────

function dateLabels(candles: Candle[], step: number): string[] {
  return candles.map((c, i) => {
    if (i % step !== 0) return '';
    const d = c.openTime ? new Date(c.openTime) : null;
    return d ? `${d.getMonth() + 1}/${d.getDate()}` : String(i);
  });
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function renderSwingPaChart(
  analysis: SwingPaAnalysis,
  dailyCandles: Candle[]
): Promise<Buffer> {
  const slice   = dailyCandles.slice(-60);
  const current = slice[slice.length - 1]!;

  const prices       = slice.flatMap((c) => [c.high, c.low]);
  const priceMin     = Math.min(...prices);
  const priceMax     = Math.max(...prices);
  const pricePad     = (priceMax - priceMin) * 0.08;

  const labels       = slice.map((_, i) => i);
  const dateStep     = Math.ceil(slice.length / 10);
  const xDateLabels  = dateLabels(slice, dateStep);

  // Sets for O(1) marker lookup
  const swingHighSet = new Set(analysis.swingHighs);
  const swingLowSet  = new Set(analysis.swingLows);
  const fibLevels    = analysis.fibLevels;

  const config: ChartConfiguration = {
    type: 'line',
    data: {
      labels,
      datasets: [
        // Invisible range anchor dataset
        {
          label: '_range',
          data: labels.map((i) =>
            i === 0 ? priceMin - pricePad :
            i === labels.length - 1 ? priceMax + pricePad : null as unknown as number
          ),
          borderWidth: 0,
          pointRadius: 0,
          hidden: true
        },
        // Current price — yellow dashed line
        {
          label: `Price $${current.close.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
          data: labels.map(() => current.close),
          borderColor: 'rgba(255, 235, 59, 0.85)',
          borderWidth: 1.5,
          borderDash: [5, 4],
          pointRadius: 0,
          fill: false
        }
      ]
    },
    options: {
      responsive: false,
      animation: false,
      layout: { padding: { top: 50, right: 70, bottom: 30, left: 10 } },
      scales: {
        x: {
          ticks: {
            color: '#888',
            font: { size: 10 },
            callback: (_val, idx) => xDateLabels[idx] ?? ''
          },
          grid: { color: 'rgba(255,255,255,0.04)' }
        },
        y: {
          position: 'right',
          ticks: { color: '#aaa', font: { size: 11 } },
          grid:  { color: 'rgba(255,255,255,0.05)' }
        }
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: '#ccc',
            font: { size: 11 },
            filter: (item) => item.text !== '_range'
          }
        },
        title: {
          display: true,
          text: [
            `${analysis.symbol}  Daily — Pure Price Action`,
            `Trend: ${analysis.trend.toUpperCase()}  |  Setup: ${analysis.setup.type ?? 'none'}`
          ],
          color: '#eee',
          font: { size: 13, weight: 'bold' },
          padding: { bottom: 8 }
        }
      }
    },
    plugins: [
      zoneBandsPlugin(analysis.srZones),
      fibonacciPlugin(fibLevels),
      candlestickPlugin(slice),
      swingMarkersPlugin(slice, swingHighSet, swingLowSet)
    ]
  };

  const canvas = new ChartJSNodeCanvas({
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    backgroundColour: '#1a1a2e'
  });

  return canvas.renderToBuffer(config);
}
