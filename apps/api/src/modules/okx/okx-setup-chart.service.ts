import { Injectable, NotFoundException } from '@nestjs/common';
import { calculateQqe } from '@app/core';
import { createOkxTradeChartRepository } from '@app/db';

import { OkxService } from './okx.service';
import { BinanceMarketDataService } from '../market/binance-market-data.service';
import { StorageService } from '../storage/storage.service';
import { renderSetupChart, QQE_PARAMS, type ChartMarker, type OhlcCandle } from '../bitget/setup-chart-renderer';

const bareSymbol = (s: string) => s.trim().toUpperCase().replace(/USDT$/, '');

/** Trim a note to a stored value; blank/whitespace-only becomes null. */
const normalizeNote = (note?: string | null): string | null => {
  const trimmed = note?.trim();
  return trimmed ? trimmed : null;
};

/** Timeframes the Setup-tab QQE column reports on — mirrors the chart-view buttons. */
const QQE_TIMEFRAMES = ['M30', '1h', '4h', '1d'] as const;
/**
 * Every timeframe a caller may ask for. `/tracking-coins` is a swing/DCA page, so it
 * requests only `4h,1d,1w` — narrowing matters because it lists ~40 coins and each
 * (coin, timeframe) pair costs one Binance klines call.
 */
const QQE_SUPPORTED_TIMEFRAMES = ['M30', '1h', '4h', '1d', '1w'] as const;
/** Candles pulled per timeframe for the QQE compute — enough to warm the bands. */
const QQE_KLINE_LIMIT = 200;
/** Min closed candles before a QQE reading is trustworthy. */
const QQE_MIN_CANDLES = 60;
/** How long a per-(symbol,tf) QQE reading is reused before recomputing. */
const QQE_CACHE_TTL_MS = 60_000;

/** Daily candles pulled to compute the 7d / 30d / 90d change (needs ≥ 91 back + today). */
const CHANGE_KLINE_LIMIT = 95;
/** 7d / 30d / 90d changes move once a day — reuse a reading for 5 minutes. */
const CHANGE_CACHE_TTL_MS = 5 * 60_000;

/**
 * Price change (as a ratio, 0.0123 = +1.23%) for a coin over 7 / 30 / 90 days,
 * each comparing the current close with the close that many days back.
 */
export type OkxPriceChange = {
  symbol: string;
  change7d: number | null;
  change30d: number | null;
  change90d: number | null;
};

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
  // Weekly: Binance only serves ~600 weekly candles for old pairs, so EMA200 stays
  // warm on majors and simply starts late on younger coins.
  '1w':  { limit: 300, display: 80  },
};

/** Candle interval (ms) per supported timeframe — used to window a closed trade. */
const TF_MS: Record<string, number> = {
  '15m': 15 * 60_000,
  'M30': 30 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
  '1w': 7 * 24 * 60 * 60_000,
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
  /** Optional free-text note, saved with the snapshot (ignored when just rendering). */
  note?: string | null;
};

// Context bars shown before the entry (also warms up EMA200) and after the exit.
const TRADE_LOOKBACK_BARS = 210;
const TRADE_AHEAD_BARS = 30;

/**
 * Renders the on-demand Setup-tab chart (SonicR + S/R channels + RSI).
 *
 * `renderSetupChart` is imported from the Bitget module on purpose: it draws
 * Binance candles and the markers it is handed, with no exchange coupling of any
 * kind, so a second 1000-line copy would only ever drift out of sync with this
 * one. Everything exchange-specific (positions, history, saved charts) goes
 * through `OkxService` / `okx_trade_charts` here.
 */
@Injectable()
export class OkxSetupChartService {
  private readonly chartRepo = createOkxTradeChartRepository();
  /** Short-lived cache of QQE readings keyed by `${bare}:${tf}` to spare Binance. */
  private readonly qqeCache = new Map<string, { at: number; value: QqeTfSignal | null }>();
  /** Short-lived cache of 7d/30d change per bare symbol to spare Binance. */
  private readonly changeCache = new Map<string, { at: number; value: OkxPriceChange }>();

  constructor(
    private readonly binance: BinanceMarketDataService,
    private readonly okx: OkxService,
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
      note: normalizeNote(params.note),
    });
  }

  /**
   * Snapshot the live Setup-tab chart: render the current PNG, upload to R2, and
   * store a DB link so it shows in the coin's Reference gallery. Unlike a trade
   * chart (keyed by a stable tradeKey), each Setup snapshot gets a timestamped
   * synthetic tradeKey so every save is preserved as its own reference image.
   */
  async saveSetupChart(symbol: string, timeframe: string, note?: string | null) {
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
      note: normalizeNote(note),
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
   * Saved-chart count per coin — one grouped query feeding the Setup tab's
   * Attachments column, which shows how many images each coin references.
   */
  async countSavedChartsBySymbol(): Promise<Array<{ symbol: string; count: number }>> {
    const rows = (await this.chartRepo.countBySymbol()) as Array<{
      symbol: string;
      _count: { _all: number };
    }>;
    return rows.map((r) => ({ symbol: r.symbol, count: r._count._all }));
  }

  /**
   * Saved-chart count per trade — the History tab's Attachments column, where
   * the gallery is scoped to one `tradeKey` instead of a whole coin.
   */
  async countSavedChartsByTradeKey(): Promise<Array<{ tradeKey: string; count: number }>> {
    const rows = (await this.chartRepo.countByTradeKey()) as Array<{
      tradeKey: string;
      _count: { _all: number };
    }>;
    return rows.map((r) => ({ tradeKey: r.tradeKey, count: r._count._all }));
  }

  /**
   * Current colinmck QQE Signals state for each coin across the M30/1h/4h/1d
   * timeframes shown in the chart view — the data behind the Setup-tab "QQE"
   * column. Readings come from the last CLOSED candle (no repaint) and are cached
   * ~60s per (symbol, timeframe) so the 15s feed refresh doesn't hammer Binance.
   */
  async getQqeSignals(symbols: string[], timeframes?: string[]): Promise<QqeSymbolSignals[]> {
    const requested = (timeframes ?? []).filter((tf): tf is (typeof QQE_SUPPORTED_TIMEFRAMES)[number] =>
      (QQE_SUPPORTED_TIMEFRAMES as readonly string[]).includes(tf),
    );
    const tfs: readonly string[] = requested.length > 0 ? requested : QQE_TIMEFRAMES;
    const uniqueBare = [...new Set(symbols.map(bareSymbol).filter(Boolean))];
    const out: QqeSymbolSignals[] = [];
    for (const bare of uniqueBare) {
      const signals: Record<string, QqeTfSignal | null> = {};
      for (const tf of tfs) {
        signals[tf] = await this.qqeForTimeframe(bare, tf);
      }
      out.push({ symbol: bare, signals });
    }
    return out;
  }

  /**
   * Price change for each coin — the data behind the Setup-tab "7 ngày",
   * "30 ngày" and "90 ngày" columns — each comparing the current close with
   * the close N days ago. Cached ~5 min per coin (none of these move faster).
   */
  async getPriceChanges(symbols: string[]): Promise<OkxPriceChange[]> {
    const uniqueBare = [...new Set(symbols.map(bareSymbol).filter(Boolean))];
    const out: OkxPriceChange[] = [];
    for (const bare of uniqueBare) {
      out.push(await this.priceChangeFor(bare));
    }
    return out;
  }

  /** 7d/30d/90d change for one coin, served from cache when still fresh. */
  private async priceChangeFor(bare: string): Promise<OkxPriceChange> {
    const cached = this.changeCache.get(bare);
    if (cached && Date.now() - cached.at < CHANGE_CACHE_TTL_MS) return cached.value;

    try {
      const klines = await this.binance.fetchKlines({
        symbol: `${bare}USDT`,
        timeframe: '1d' as never,
        limit: CHANGE_KLINE_LIMIT,
      });
      const closes = klines.map((k) => parseFloat(k[4]));
      const n = closes.length;
      const current = n > 0 ? closes[n - 1]! : NaN;
      // `d` days ago = the close `d` candles back from the current (forming) one.
      const changeAgo = (d: number): number | null => {
        const past = n > d ? closes[n - 1 - d] : undefined;
        return past != null && past > 0 && Number.isFinite(current)
          ? (current - past) / past
          : null;
      };
      const value: OkxPriceChange = {
        symbol: bare,
        change7d: changeAgo(7),
        change30d: changeAgo(30),
        change90d: changeAgo(90),
      };
      this.changeCache.set(bare, { at: Date.now(), value });
      return value;
    } catch {
      // Transient fetch failure: reuse last-known reading, else blanks.
      return cached?.value ?? { symbol: bare, change7d: null, change30d: null, change90d: null };
    }
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
   * still renders if OKX/DB are unavailable.
   */
  private async buildMarkers(bare: string): Promise<ChartMarker[]> {
    const markers: ChartMarker[] = [];

    const positions = await this.okx.getOpenPositions().catch(() => null);
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
    const history = await this.okx.getClosedHistory(50, `${bare}USDT`).catch(() => null);
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
