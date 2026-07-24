import { Injectable, NotFoundException } from '@nestjs/common';
import { calculateQqe } from '@app/core';
import { createBitgetTradeChartRepository } from '@app/db';

import { BitgetService } from './bitget.service';
import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { StorageService } from '../storage/storage.service';
import { renderSetupChart, QQE_PARAMS, type ChartMarker, type OhlcCandle } from './setup-chart-renderer';

const bareSymbol = (s: string) => s.trim().toUpperCase().replace(/USDT$/, '');

/** Timeframes the Setup-tab QQE column reports on — mirrors the chart-view buttons. */
const QQE_TIMEFRAMES = ['M30', '1h', '4h', '1d'] as const;
/** Candles pulled per timeframe for the QQE compute — enough to warm the bands. */
const QQE_KLINE_LIMIT = 200;
/** Min closed candles before a QQE reading is trustworthy. */
const QQE_MIN_CANDLES = 60;
/** How long a per-(symbol,tf) QQE reading is reused before recomputing. */
const QQE_CACHE_TTL_MS = 60_000;

/** Current colinmck QQE state on one timeframe's last CLOSED candle. */
export type QqeTfSignal = {
  state: 'long' | 'short';
  /** Closed candles since the last Long/Short flip (null if none in window). */
  barsSince: number | null;
  /** The last closed candle IS the flip bar — a brand-new signal. */
  freshCross: boolean;
};

export type QqeSymbolSignals = { symbol: string; signals: Record<string, QqeTfSignal | null> };

// `limit` must cover `display` + 200 bars so the EMA200 line is warm across the
// whole displayed window (EMA200 needs 200 prior candles before its first value).
const TF_CONFIG: Record<string, { limit: number; display: number }> = {
  '15m': { limit: 500, display: 200 },
  'M30': { limit: 500, display: 200 },
  '1h':  { limit: 400, display: 150 },
  '4h':  { limit: 340, display: 120 },
  '1d':  { limit: 300, display: 90  },
};

/** Candle interval (ms) per supported timeframe — used to window a closed trade. */
const TF_MS: Record<string, number> = {
  '15m': 15 * 60_000,
  'M30': 30 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

/** A closed trade to render a review chart for (all fields come from history). */
export type TradeChartParams = {
  tradeKey: string;
  symbol: string;
  timeframe: string;
  holdSide: 'long' | 'short';
  entryPrice: number;
  closePrice: number;
  pnlUsd: number;
  openedAt: number; // ms
  closedAt: number; // ms
};

// Context bars shown before the entry (also warms up EMA200) and after the exit.
const TRADE_LOOKBACK_BARS = 210;
const TRADE_AHEAD_BARS = 30;

/** Renders the on-demand Setup-tab chart (SonicR + S/R channels + RSI). */
@Injectable()
export class BitgetSetupChartService {
  private readonly chartRepo = createBitgetTradeChartRepository();
  /** Short-lived cache of QQE readings keyed by `${bare}:${tf}` to spare Binance. */
  private readonly qqeCache = new Map<string, { at: number; value: QqeTfSignal | null }>();

  constructor(
    private readonly binance: BinanceMarketDataService,
    private readonly bitget: BitgetService,
    private readonly storage: StorageService,
  ) {}

  async generateChart(symbol: string, timeframe = 'M30'): Promise<Buffer> {
    const bare = bareSymbol(symbol);
    const pair = `${bare}USDT`;
    const tf = TF_CONFIG[timeframe] ? timeframe : 'M30';
    const { limit, display } = TF_CONFIG[tf]!;

    const klines = await this.binance.fetchKlines({
      symbol: pair,
      timeframe: tf as never,
      limit,
    });
    if (klines.length === 0) {
      throw new NotFoundException(`No ${tf} candles for ${pair}`);
    }

    const candles: OhlcCandle[] = klines.map((k) => ({
      time: Number(k[0]),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));

    const markers = await this.buildMarkers(bare);

    return renderSetupChart({
      symbol: pair,
      timeframe: tf,
      candles,
      currentPrice: candles[candles.length - 1]!.close,
      display,
      markers,
    });
  }

  /**
   * Review chart for one closed trade: fetches candles windowed around the
   * holding period (with lookback for indicator warmup), then draws the same
   * indicators plus entry/close price lines + vertical Vào/Đóng markers.
   */
  async generateTradeChart(params: TradeChartParams): Promise<Buffer> {
    const bare = bareSymbol(params.symbol);
    const pair = `${bare}USDT`;
    const tf = TF_MS[params.timeframe] ? params.timeframe : 'M30';
    const tfMs = TF_MS[tf]!;

    const startTime = params.openedAt - TRADE_LOOKBACK_BARS * tfMs;
    const endTime = params.closedAt + TRADE_AHEAD_BARS * tfMs;

    const klines = await this.binance.fetchKlinesInRange({
      symbol: pair,
      timeframe: tf as never,
      startTime,
      endTime,
      limit: 1000,
    });
    if (klines.length === 0) {
      throw new NotFoundException(`No ${tf} candles for ${pair} around the trade window`);
    }

    const candles: OhlcCandle[] = klines.map((k) => ({
      time: Number(k[0]),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));

    // Locate the candle whose window contains the open / close timestamps.
    const idxOf = (t: number) => {
      let idx = 0;
      for (let i = 0; i < candles.length; i++) {
        if (candles[i]!.time <= t) idx = i;
        else break;
      }
      return idx;
    };

    return renderSetupChart({
      symbol: pair,
      timeframe: tf,
      candles,
      currentPrice: candles[candles.length - 1]!.close,
      // Show every fetched candle — the lookback bars sit on the left, warm.
      display: candles.length,
      markers: [
        {
          kind: 'closed',
          holdSide: params.holdSide,
          entryPrice: params.entryPrice,
          closePrice: params.closePrice,
          pnlUsd: params.pnlUsd,
        },
      ],
      tradeSpan: {
        openIndex: idxOf(params.openedAt),
        closeIndex: idxOf(params.closedAt),
        win: params.pnlUsd >= 0,
      },
    });
  }

  /**
   * Render the trade chart, upload the PNG to R2, and upsert the DB link so the
   * trader can reference it later. Returns the stored record.
   */
  async saveTradeChart(params: TradeChartParams) {
    const buffer = await this.generateTradeChart(params);
    const bare = bareSymbol(params.symbol);
    const objectKey = `trade-charts/${bare}/${params.tradeKey}-${params.timeframe}.png`;

    const stored = await this.storage.uploadFile(
      {
        buffer,
        mimetype: 'image/png',
        originalname: `${bare}-${params.timeframe}.png`,
        size: buffer.length,
      },
      objectKey,
    );

    return this.chartRepo.upsert({
      tradeKey: params.tradeKey,
      symbol: `${bare}USDT`,
      timeframe: params.timeframe,
      url: stored.url,
      objectKey: stored.key,
    });
  }

  /**
   * Snapshot the live Setup-tab chart: render the current PNG, upload to R2, and
   * store a DB link so it shows in the coin's Reference gallery. Unlike a trade
   * chart (keyed by a stable tradeKey), each Setup snapshot gets a timestamped
   * synthetic tradeKey so every save is preserved as its own reference image.
   */
  async saveSetupChart(symbol: string, timeframe: string) {
    const bare = bareSymbol(symbol);
    const tf = TF_CONFIG[timeframe] ? timeframe : 'M30';
    const buffer = await this.generateChart(symbol, tf);
    const ts = Date.now();
    const tradeKey = `setup-${bare}-${tf}-${ts}`;
    const objectKey = `setup-charts/${bare}/${tf}-${ts}.png`;

    const stored = await this.storage.uploadFile(
      {
        buffer,
        mimetype: 'image/png',
        originalname: `${bare}-${tf}.png`,
        size: buffer.length,
      },
      objectKey,
    );

    return this.chartRepo.upsert({
      tradeKey,
      symbol: `${bare}USDT`,
      timeframe: tf,
      url: stored.url,
      objectKey: stored.key,
    });
  }

  /** All saved chart snapshots for a trade (any timeframe). */
  listSavedCharts(tradeKey: string) {
    return this.chartRepo.findByTradeKey(tradeKey);
  }

  /** All saved chart snapshots for one coin (any trade / timeframe). */
  listSavedChartsBySymbol(symbol: string) {
    const bare = bareSymbol(symbol);
    if (!bare) return [];
    return this.chartRepo.findBySymbol(`${bare}USDT`);
  }

  /**
   * Current colinmck QQE Signals state for each coin across the M30/1h/4h/1d
   * timeframes shown in the chart view — the data behind the Setup-tab "QQE"
   * column. Readings come from the last CLOSED candle (no repaint) and are cached
   * ~60s per (symbol, timeframe) so the 15s feed refresh doesn't hammer Binance.
   */
  async getQqeSignals(symbols: string[]): Promise<QqeSymbolSignals[]> {
    const uniqueBare = [...new Set(symbols.map(bareSymbol).filter(Boolean))];
    const out: QqeSymbolSignals[] = [];
    for (const bare of uniqueBare) {
      const signals: Record<string, QqeTfSignal | null> = {};
      for (const tf of QQE_TIMEFRAMES) {
        signals[tf] = await this.qqeForTimeframe(bare, tf);
      }
      out.push({ symbol: bare, signals });
    }
    return out;
  }

  /** QQE reading for one (coin, timeframe), served from cache when still fresh. */
  private async qqeForTimeframe(bare: string, tf: string): Promise<QqeTfSignal | null> {
    const cacheKey = `${bare}:${tf}`;
    const cached = this.qqeCache.get(cacheKey);
    if (cached && Date.now() - cached.at < QQE_CACHE_TTL_MS) return cached.value;

    try {
      const klines = await this.binance.fetchKlines({
        symbol: `${bare}USDT`,
        timeframe: tf as never,
        limit: QQE_KLINE_LIMIT,
      });
      const now = Date.now();
      // Only fully-closed candles — the forming candle would repaint the signal.
      const closes = klines.filter((k) => Number(k[6]) <= now).map((k) => parseFloat(k[4]));
      const value = closes.length >= QQE_MIN_CANDLES ? deriveQqeSignal(closes) : null;
      this.qqeCache.set(cacheKey, { at: now, value });
      return value;
    } catch {
      // Transient fetch failure: reuse last-known reading rather than blanking it.
      return cached?.value ?? null;
    }
  }

  /**
   * Entry/exit annotations for this coin: every live open position (entry line +
   * uPnL) plus the most recent closed trade that closed within the last 30
   * minutes (entry + close lines with realized PnL) — once a trade has been shut
   * longer than that the markers drop off. All lookups are non-fatal — the chart
   * still renders if Bitget/DB are unavailable.
   */
  private async buildMarkers(bare: string): Promise<ChartMarker[]> {
    const markers: ChartMarker[] = [];

    const positions = await this.bitget.getOpenPositions().catch(() => null);
    for (const p of positions?.positions ?? []) {
      if (bareSymbol(p.symbol) !== bare) continue;
      markers.push({
        kind: 'open',
        holdSide: p.holdSide,
        entryPrice: p.entryPrice,
        pnlUsd: p.unrealizedPnlUsd,
      });
    }
    const openSides = new Set(markers.map((m) => m.holdSide));

    const recentlyClosedAfter = Date.now() - 30 * 60 * 1000;
    const history = await this.bitget.getClosedHistory(50, `${bare}USDT`).catch(() => null);
    const recentClosed = (history?.trades ?? [])
      .filter(
        (t) =>
          bareSymbol(t.symbol) === bare &&
          new Date(t.closedAt).getTime() >= recentlyClosedAfter &&
          // Skip if that side is already shown as an open position.
          !openSides.has(t.holdSide),
      )
      .sort((a, b) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime())[0];

    if (recentClosed) {
      markers.push({
        kind: 'closed',
        holdSide: recentClosed.holdSide,
        entryPrice: recentClosed.openAvgPrice,
        closePrice: recentClosed.closeAvgPrice,
        pnlUsd: recentClosed.netProfit,
      });
    }

    return markers;
  }
}

/**
 * Collapses a colinmck QQE run over `closes` into the state of the last usable
 * candle: which side the trailing line is on (long = below rsiMa), how many bars
 * it's held, and whether that last bar is itself the flip.
 */
function deriveQqeSignal(closes: number[]): QqeTfSignal | null {
  const { rsiMa, signal, cross } = calculateQqe(
    closes,
    QQE_PARAMS.rsiPeriod,
    QQE_PARAMS.smoothing,
    QQE_PARAMS.qqeFactor,
  );

  let last = -1;
  for (let i = closes.length - 1; i >= 0; i--) {
    if (Number.isFinite(rsiMa[i]!) && Number.isFinite(signal[i]!)) {
      last = i;
      break;
    }
  }
  if (last < 0) return null;

  const state: 'long' | 'short' = signal[last]! < rsiMa[last]! ? 'long' : 'short';

  let flip = -1;
  for (let i = last; i >= 0; i--) {
    if (cross[i]) {
      flip = i;
      break;
    }
  }
  return {
    state,
    barsSince: flip >= 0 ? last - flip : null,
    freshCross: flip === last,
  };
}
