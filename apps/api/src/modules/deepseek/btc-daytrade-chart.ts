import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import type { ChartConfiguration } from 'chart.js';
import type { Candle } from '@app/core';

import type { BtcPaSnapshot, TimeframeReport } from './btc-pa-snapshot.service';

/**
 * The PNG attached to every BTC day-trading analysis: 4H on top for context,
 * 15m below for the entry, with the exact price action the agent reasoned over
 * drawn on both — pivots, trend lines, Fibonacci and horizontal levels — plus
 * the entry zone / stop / targets on the 15m panel.
 *
 * Chart.js is used only as a canvas host here: everything is drawn by hand in a
 * plugin. Two stacked price panes with their own overlays is not something the
 * library's scales model well, and the alternative — bending a line chart into
 * candles with a dozen fake datasets — is harder to read than the raw 2D calls.
 * Deliberately no indicator overlays: the chart has to show what the agent was
 * given, and it was given no indicators.
 */

/** The trade geometry drawn on the entry panel. Structural, to avoid a cycle with the service. */
export type ChartSignal = {
  direction: 'LONG' | 'SHORT' | 'NO_TRADE';
  entryFrom: number | null;
  entryTo: number | null;
  stopLoss: number | null;
  takeProfits: number[];
  riskReward: number | null;
};

export type BtcDaytradeChartInput = {
  snapshot: BtcPaSnapshot;
  /** Closed candles per timeframe id, as fetched for the snapshot. */
  candles: Record<string, Candle[]>;
  signal: ChartSignal | null;
  /** Day label already formatted in Vietnam time, e.g. "18/08/2026 14:30". */
  capturedLabel: string;
};

const WIDTH = 1240;
const HEIGHT = 980;
const HEADER_H = 62;
const FOOTER_H = 34;
const PANEL_GAP = 26;
/** Strip under each pane for its time labels — without it they land on the footer. */
const AXIS_H = 18;
const PLOT_LEFT = 58;
/** Room on the right for the price axis labels. */
const PLOT_RIGHT_PAD = 92;
/** Candles shown per panel — enough context without turning bodies into hairlines. */
const BARS = { '4h': 60, '15m': 72 } as const;

const C = {
  bg: '#ffffff',
  ink: '#1f2933',
  muted: '#7b8794',
  grid: '#eef1f4',
  axis: '#cbd2d9',
  up: '#1f9d57',
  down: '#d33a2c',
  fib: '#c77700',
  trend: '#2f6fb0',
  level: '#9aa5b1',
  entry: '#1f6feb',
  stop: '#d33a2c',
  target: '#1f9d57',
} as const;

const fmtPrice = (n: number): string =>
  `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

/** Vietnam-time clock label for the x axis (the trader reads local time). */
function timeLabel(date: Date, withDay: boolean): string {
  const vn = new Date(date.getTime() + 7 * 3600_000);
  const hh = String(vn.getUTCHours()).padStart(2, '0');
  const mm = String(vn.getUTCMinutes()).padStart(2, '0');
  const dd = String(vn.getUTCDate()).padStart(2, '0');
  const mo = String(vn.getUTCMonth() + 1).padStart(2, '0');
  return withDay ? `${dd}/${mo} ${hh}:${mm}` : `${hh}:${mm}`;
}

type Rect = { x: number; y: number; w: number; h: number };

/** One stacked pane: a timeframe's candles plus everything drawn over them. */
type Panel = {
  report: TimeframeReport;
  candles: Candle[];
  /** Draw the trade geometry on this pane (the entry timeframe only). */
  withSignal: boolean;
};

export async function renderBtcDaytradeChart(input: BtcDaytradeChartInput): Promise<Buffer> {
  const panels = buildPanels(input);

  const config: ChartConfiguration = {
    type: 'bar',
    data: { labels: [], datasets: [] },
    options: {
      responsive: false,
      animation: false,
      events: [],
      layout: { padding: 0 },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } },
    },
    plugins: [
      {
        id: 'btc-daytrade-pa',
        afterDraw(chart) {
          draw(chart.ctx as unknown as CanvasRenderingContext2D, input, panels);
        },
      },
    ],
  };

  const canvas = new ChartJSNodeCanvas({ width: WIDTH, height: HEIGHT, backgroundColour: C.bg });
  return canvas.renderToBuffer(config);
}

/** Pick the timeframes to plot; a missing series simply drops its pane. */
function buildPanels(input: BtcDaytradeChartInput): Panel[] {
  const wanted: Array<{ tf: keyof typeof BARS; withSignal: boolean }> = [
    { tf: '4h', withSignal: false },
    { tf: '15m', withSignal: true },
  ];

  return wanted.flatMap(({ tf, withSignal }) => {
    const report = input.snapshot.timeframes.find((r) => r.timeframe === tf);
    const series = input.candles[tf];
    if (!report || !series || series.length === 0) return [];
    return [{ report, candles: series.slice(-BARS[tf]), withSignal }];
  });
}

function draw(ctx: CanvasRenderingContext2D, input: BtcDaytradeChartInput, panels: Panel[]): void {
  ctx.save();
  ctx.textBaseline = 'middle';

  drawHeader(ctx, input);

  // Each panel owns a block: gap on top, pane, then its own axis strip.
  const block = (HEIGHT - HEADER_H - FOOTER_H) / Math.max(panels.length, 1);
  panels.forEach((panel, i) => {
    const rect: Rect = {
      x: PLOT_LEFT,
      y: HEADER_H + block * i + PANEL_GAP,
      w: WIDTH - PLOT_LEFT - PLOT_RIGHT_PAD,
      h: block - PANEL_GAP - AXIS_H,
    };
    drawPanel(ctx, rect, panel, input);
  });

  drawFooter(ctx, input.signal);
  ctx.restore();
}

function drawHeader(ctx: CanvasRenderingContext2D, input: BtcDaytradeChartInput): void {
  const { snapshot, signal } = input;

  ctx.fillStyle = C.ink;
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${snapshot.symbol} — price action day trade`, PLOT_LEFT, 26);

  ctx.fillStyle = C.muted;
  ctx.font = '13px sans-serif';
  ctx.fillText(
    `${input.capturedLabel} (giờ VN) · giá ${fmtPrice(snapshot.price)} · 24h ${
      snapshot.change24hPct == null ? 'n/a' : `${snapshot.change24hPct >= 0 ? '+' : ''}${snapshot.change24hPct.toFixed(2)}%`
    }`,
    PLOT_LEFT,
    47,
  );

  const label =
    signal == null || signal.direction === 'NO_TRADE' ? 'ĐỨNG NGOÀI' : signal.direction;
  const colour =
    signal?.direction === 'LONG' ? C.up : signal?.direction === 'SHORT' ? C.down : C.muted;
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillStyle = colour;
  ctx.fillText(label, WIDTH - PLOT_RIGHT_PAD + 60, 26);

  if (signal?.riskReward != null) {
    ctx.font = '13px sans-serif';
    ctx.fillStyle = C.muted;
    ctx.fillText(`R/R ${signal.riskReward.toFixed(2)}`, WIDTH - PLOT_RIGHT_PAD + 60, 47);
  }
}

function drawFooter(ctx: CanvasRenderingContext2D, signal: ChartSignal | null): void {
  ctx.textAlign = 'left';
  ctx.font = '13px sans-serif';
  ctx.fillStyle = C.muted;

  const y = HEIGHT - FOOTER_H / 2;
  if (!signal || signal.direction === 'NO_TRADE') {
    ctx.fillText('Không có setup đạt tiêu chí — đứng ngoài.', PLOT_LEFT, y);
    return;
  }

  const entry =
    signal.entryFrom == null
      ? '—'
      : signal.entryTo == null || signal.entryTo === signal.entryFrom
        ? fmtPrice(signal.entryFrom)
        : `${fmtPrice(Math.min(signal.entryFrom, signal.entryTo))}–${fmtPrice(Math.max(signal.entryFrom, signal.entryTo))}`;
  const tps = signal.takeProfits.length > 0 ? signal.takeProfits.map(fmtPrice).join(' / ') : '—';

  ctx.fillText(
    `${signal.direction} · vào ${entry} · SL ${signal.stopLoss == null ? '—' : fmtPrice(signal.stopLoss)} · TP ${tps}` +
      `${signal.riskReward == null ? '' : ` · R/R ${signal.riskReward.toFixed(2)}`}`,
    PLOT_LEFT,
    y,
  );
}

function drawPanel(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  panel: Panel,
  input: BtcDaytradeChartInput,
): void {
  const { report, candles } = panel;
  const signal = panel.withSignal ? input.signal : null;
  const price = input.snapshot.price;

  // Price range from the candles, widened only by levels that are already close
  // enough to matter. A fib level or a stop far outside the window would squash
  // every candle into a band a few pixels tall.
  const values = candles.flatMap((c) => [c.high, c.low]);
  let lo = Math.min(...values, price);
  let hi = Math.max(...values, price);
  const span = hi - lo || hi * 0.01;
  const inRange = (v: number | null | undefined): boolean =>
    v != null && Number.isFinite(v) && v > lo - span * 0.35 && v < hi + span * 0.35;

  const extras = [
    ...(signal
      ? [signal.entryFrom, signal.entryTo, signal.stopLoss, ...signal.takeProfits]
      : []),
  ].filter(inRange) as number[];
  lo = Math.min(lo, ...extras);
  hi = Math.max(hi, ...extras);
  const pad = (hi - lo) * 0.06 || hi * 0.005;
  lo -= pad;
  hi += pad;

  const yOf = (p: number): number => rect.y + rect.h - ((p - lo) / (hi - lo)) * rect.h;
  const step = rect.w / (candles.length + 1);
  const xOf = (i: number): number => rect.x + step * (i + 0.5);
  const visible = (p: number): boolean => p >= lo && p <= hi;

  drawGrid(ctx, rect, lo, hi, yOf);
  drawTimeAxis(ctx, rect, candles, xOf);

  // Horizontal pivot levels first — they are the backdrop everything else sits on.
  for (const level of [...report.supports, ...report.resistances]) {
    if (!visible(level)) continue;
    line(ctx, rect.x, yOf(level), rect.x + rect.w, yOf(level), C.level, 1, [2, 4]);
  }

  drawFib(ctx, rect, report, yOf, visible);
  drawTrendLines(ctx, rect, report, candles, xOf, yOf, lo, hi);
  drawCandles(ctx, candles, step, xOf, yOf);
  drawPivots(ctx, report, candles, xOf, yOf);

  // Live price marker, then the trade geometry on top of everything.
  line(ctx, rect.x, yOf(price), rect.x + rect.w, yOf(price), C.ink, 1, [5, 4]);
  priceTag(ctx, rect, yOf(price), fmtPrice(price), C.ink, '#ffffff');
  if (signal) drawSignal(ctx, rect, signal, yOf, visible);

  // Pane title last, on its own white plate — price lines run the full width of
  // the pane and would otherwise strike straight through the text.
  const structure = { uptrend: 'TĂNG', downtrend: 'GIẢM', range: 'ĐI NGANG' }[report.structure];
  const titleTop = `${report.label} — ${report.role}`;
  const titleSub = `cấu trúc ${structure} (${report.structureNote})`;
  ctx.textAlign = 'left';
  ctx.font = 'bold 14px sans-serif';
  const plateW = Math.max(ctx.measureText(titleTop).width, ctx.measureText(titleSub).width) + 14;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
  ctx.fillRect(rect.x + 1, rect.y + 1, plateW, 44);
  ctx.fillStyle = C.ink;
  ctx.fillText(titleTop, rect.x + 6, rect.y + 15);
  ctx.font = '12px sans-serif';
  ctx.fillStyle = report.structure === 'uptrend' ? C.up : report.structure === 'downtrend' ? C.down : C.muted;
  ctx.fillText(titleSub, rect.x + 6, rect.y + 33);
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  lo: number,
  hi: number,
  yOf: (p: number) => number,
): void {
  ctx.strokeStyle = C.axis;
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

  ctx.textAlign = 'left';
  ctx.font = '11px sans-serif';
  const rows = 5;
  for (let i = 0; i <= rows; i++) {
    const p = lo + ((hi - lo) * i) / rows;
    const y = yOf(p);
    line(ctx, rect.x, y, rect.x + rect.w, y, C.grid, 1);
    ctx.fillStyle = C.muted;
    ctx.fillText(fmtPrice(p), rect.x + rect.w + 8, y);
  }
}

function drawTimeAxis(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  candles: Candle[],
  xOf: (i: number) => number,
): void {
  ctx.font = '11px sans-serif';
  ctx.fillStyle = C.muted;
  ctx.textAlign = 'center';
  const every = Math.max(1, Math.round(candles.length / 6));
  candles.forEach((c, i) => {
    if (i % every !== 0) return;
    const at = c.closeTime ?? new Date();
    ctx.fillText(timeLabel(at, candles.length <= 70), xOf(i), rect.y + rect.h + 12);
  });
}

function drawCandles(
  ctx: CanvasRenderingContext2D,
  candles: Candle[],
  step: number,
  xOf: (i: number) => number,
  yOf: (p: number) => number,
): void {
  const body = Math.max(2, Math.min(step * 0.66, 14));
  candles.forEach((c, i) => {
    const x = xOf(i);
    const colour = c.close >= c.open ? C.up : C.down;
    line(ctx, x, yOf(c.high), x, yOf(c.low), colour, 1);
    const top = yOf(Math.max(c.open, c.close));
    const height = Math.max(1, Math.abs(yOf(c.open) - yOf(c.close)));
    ctx.fillStyle = colour;
    ctx.fillRect(x - body / 2, top, body, height);
  });
}

/** Fib retracements of the leg, labelled at the left edge. */
function drawFib(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  report: TimeframeReport,
  yOf: (p: number) => number,
  visible: (p: number) => boolean,
): void {
  if (!report.fib) return;
  ctx.textAlign = 'left';
  ctx.font = '11px sans-serif';

  for (const level of report.fib.retracements) {
    if (!visible(level.price)) continue;
    const key = level.ratio === 0.382 || level.ratio === 0.5 || level.ratio === 0.618;
    const y = yOf(level.price);
    line(ctx, rect.x, y, rect.x + rect.w, y, C.fib, key ? 1.2 : 0.8, key ? [] : [3, 4]);
    ctx.fillStyle = C.fib;
    ctx.fillText(`${level.ratio} · ${fmtPrice(level.price)}`, rect.x + 6, y - 8);
  }
}

/**
 * Trend lines are rebuilt from `priceNow` (the line's value at the still-forming
 * bar) and its slope per bar, walking backwards — matching the anchor pivots by
 * timestamp alone would fail whenever they sit outside the display window, and
 * this cannot disagree with the numbers the model was given.
 *
 * Drawing starts at the line's first anchor (never before it — a line does not
 * exist before the pivots that define it) and stops as soon as it leaves the
 * price range. Without that clip, a steep line extrapolated back across 60 bars
 * draws a diagonal straight through the whole pane and reads as a channel that
 * was never there.
 */
function drawTrendLines(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  report: TimeframeReport,
  candles: Candle[],
  xOf: (i: number) => number,
  yOf: (p: number) => number,
  lo: number,
  hi: number,
): void {
  const bars = candles.length;
  const indexByTime = new Map<string, number>();
  candles.forEach((c, i) => indexByTime.set((c.closeTime ?? new Date()).toISOString(), i));

  for (const tl of report.trendLines) {
    const priceAt = (i: number): number => tl.priceNow - tl.slopePerBar * (bars - i);
    const inRange = (i: number): boolean => priceAt(i) >= lo && priceAt(i) <= hi;

    let start = indexByTime.get(tl.from.time) ?? 0;
    while (start < bars && !inRange(start)) start++;
    let end = bars;
    while (end > start && !inRange(end)) end--;
    if (end - start < 1) continue;

    line(
      ctx,
      xOf(start),
      yOf(priceAt(start)),
      xOf(end),
      yOf(priceAt(end)),
      C.trend,
      tl.broken ? 1 : 1.6,
      tl.broken ? [6, 5] : [],
    );
    ctx.fillStyle = C.trend;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(
      `${tl.kind === 'support' ? 'TL đáy' : 'TL đỉnh'}${tl.broken ? ' (gãy)' : ''}`,
      Math.min(xOf(end), rect.x + rect.w) - 4,
      yOf(priceAt(end)) - 8,
    );
  }
}

/** HH / HL / LH / LL labels on the bars they were read from. */
function drawPivots(
  ctx: CanvasRenderingContext2D,
  report: TimeframeReport,
  candles: Candle[],
  xOf: (i: number) => number,
  yOf: (p: number) => number,
): void {
  const indexByTime = new Map<string, number>();
  candles.forEach((c, i) => indexByTime.set((c.closeTime ?? new Date()).toISOString(), i));

  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  for (const pivot of report.pivots) {
    const i = indexByTime.get(pivot.time);
    if (i == null) continue;
    const x = xOf(i);
    const y = yOf(pivot.price);
    const high = pivot.kind === 'high';
    ctx.fillStyle = high ? C.down : C.up;
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(pivot.label, x, high ? y - 14 : y + 16);
  }
}

/** Entry band, stop and targets — only on the entry timeframe. */
function drawSignal(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  signal: ChartSignal,
  yOf: (p: number) => number,
  visible: (p: number) => boolean,
): void {
  if (signal.direction === 'NO_TRADE') return;
  ctx.textAlign = 'left';
  ctx.font = 'bold 11px sans-serif';

  if (signal.entryFrom != null && visible(signal.entryFrom)) {
    const to = signal.entryTo ?? signal.entryFrom;
    const top = yOf(Math.max(signal.entryFrom, to));
    const height = Math.max(2, Math.abs(yOf(signal.entryFrom) - yOf(to)));
    ctx.fillStyle = 'rgba(31, 111, 235, 0.14)';
    ctx.fillRect(rect.x, top, rect.w, height);
    line(ctx, rect.x, top, rect.x + rect.w, top, C.entry, 1.2);
    line(ctx, rect.x, top + height, rect.x + rect.w, top + height, C.entry, 1.2);
    priceTag(ctx, rect, top + height / 2, `VÀO ${fmtPrice(signal.entryFrom)}`, '#ffffff', C.entry);
  }

  if (signal.stopLoss != null && visible(signal.stopLoss)) {
    const y = yOf(signal.stopLoss);
    line(ctx, rect.x, y, rect.x + rect.w, y, C.stop, 1.6, [7, 4]);
    priceTag(ctx, rect, y, `SL ${fmtPrice(signal.stopLoss)}`, '#ffffff', C.stop);
  }

  signal.takeProfits.forEach((tp, i) => {
    if (!visible(tp)) return;
    const y = yOf(tp);
    line(ctx, rect.x, y, rect.x + rect.w, y, C.target, 1.4, [7, 4]);
    priceTag(ctx, rect, y, `TP${i + 1} ${fmtPrice(tp)}`, '#ffffff', C.target);
  });
}

/** A filled label sitting just inside the right edge of a pane. */
function priceTag(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  y: number,
  text: string,
  fg: string,
  bg: string,
): void {
  ctx.font = 'bold 11px sans-serif';
  const w = ctx.measureText(text).width + 10;
  const x = rect.x + rect.w - w - 4;
  ctx.fillStyle = bg;
  ctx.fillRect(x, y - 8, w, 16);
  ctx.strokeStyle = fg === '#ffffff' ? bg : C.axis;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y - 8, w, 16);
  ctx.fillStyle = fg;
  ctx.textAlign = 'left';
  ctx.fillText(text, x + 5, y);
}

function line(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  colour: string,
  width = 1,
  dash: number[] = [],
): void {
  ctx.save();
  ctx.beginPath();
  ctx.setLineDash(dash);
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}
