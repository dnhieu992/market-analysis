import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { createJunkShortCoinRepository } from '@app/db';

/**
 * Live market stats for the /short-junk table, all from Binance public endpoints:
 *  · bulk every read (cached 15 s): spot products (price, circulating supply → cap, tags), USDT-M
 *    24h tickers, premium index (funding rate + next funding time)
 *  · cached 1 h: futures exchangeInfo (listing date), fundingInfo (1h / 4h interval; absent = 8h)
 *  · cached until the next UTC day: 92 closed D1 futures candles per coin (3D…90D baselines)
 *  · cached 24 h: all-time high = highest weekly high on Binance spot (longer history) and USDT-M futures
 *  · stored once in DB: first spot D1 candle = spot listing date
 */

const PRODUCTS_URL = 'https://www.binance.com/bapi/asset/v2/public/asset-service/product/get-products?includeEtf=false';
const SPOT = process.env.BINANCE_SPOT_BASE_URL ?? 'https://api.binance.com';
const FAPI = () => process.env.BINANCE_FAPI_BASE_URL ?? 'https://fapi.binance.com';
const DAY_MS = 86_400_000;
const LIVE_CACHE_MS = 15_000;
const META_CACHE_MS = 3_600_000;
const CONCURRENCY = 8;
const ATH_CACHE_MS = 24 * 3_600_000;

/** Binance product tags → ecosystem label. Program tags (Seed, Launchpool, HODLer…) are left out. */
const ECOSYSTEM: Record<string, string> = {
  Meme: 'Meme',
  Layer1_Layer2: 'Layer 1/2',
  defi: 'DeFi',
  Infrastructure: 'Infrastructure',
  AI: 'AI',
  Gaming: 'Gaming',
  NFT: 'NFT',
  RWA: 'RWA',
  Solana: 'Solana',
  BSC: 'BNB Chain',
  Payments: 'Payments',
  'storage-zone': 'Storage',
  fan_token: 'Fan token',
  stablecoin: 'Stablecoin',
};

type Product = { s: string; b: string; q: string; st: string; c: string; an: string; cs: number | null; tags: string[] | null };
type Ticker = { symbol: string; lastPrice: string; priceChangePercent: string; quoteVolume: string };
type Premium = { symbol: string; markPrice: string; lastFundingRate: string; nextFundingTime: number };
type FundingInfo = { symbol: string; fundingIntervalHours: number };
type PerpSymbol = { symbol: string; onboardDate: number };

export type JunkCoinStat = {
  symbol: string;
  name: string | null;
  price: number | null;
  marketCapUsd: number | null;
  quoteVolume24hUsd: number | null;
  change24hPct: number | null;
  change3dPct: number | null;
  change7dPct: number | null;
  change30dPct: number | null;
  change90dPct: number | null;
  /** Highest weekly high on Binance spot + USDT-M futures (or the live price if above). */
  athPrice: number | null;
  athDate: string | null;
  /** % the price is below the ATH (85 = 85% below). */
  belowAthPct: number | null;
  fundingRatePct: number | null;
  fundingIntervalHours: number;
  nextFundingTime: number | null;
  ecosystems: string[];
  monitoring: boolean;
  onSpot: boolean;
  spotListedAt: string | null;
  futuresListedAt: string | null;
};

export type JunkCoinStatsResponse = { updatedAt: string; stats: JunkCoinStat[] };

async function get<T>(url: string): Promise<T> {
  const { data } = await axios.get<T>(url, { timeout: 15_000 });
  return data;
}

async function mapLimit<T>(items: readonly T[], fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) await fn(items[next++] as T);
    }),
  );
}

const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

@Injectable()
export class JunkShortStatsService {
  private readonly logger = new Logger(JunkShortStatsService.name);
  private readonly repo = createJunkShortCoinRepository();
  private live: { at: number; key: string; value: JunkCoinStatsResponse } | null = null;
  private meta: { at: number; onboard: Map<string, number>; interval: Map<string, number> } | null = null;
  /** Closed D1 futures closes per symbol, oldest → newest, valid for one UTC day. */
  private readonly closes = new Map<string, { day: number; closes: number[] }>();
  private inflight: Promise<JunkCoinStatsResponse> | null = null;
  private readonly ath = new Map<string, { at: number; price: number; time: number }>();

  async stats(): Promise<JunkCoinStatsResponse> {
    const rows = await this.repo.findAll();
    const key = rows.map((r) => r.symbol).join(',');
    if (this.live && this.live.key === key && Date.now() - this.live.at < LIVE_CACHE_MS) return this.live.value;
    // Many tabs polling at once share one Binance round.
    this.inflight ??= this.compute(rows).finally(() => (this.inflight = null));
    const value = await this.inflight;
    this.live = { at: Date.now(), key, value };
    return value;
  }

  private async compute(rows: Awaited<ReturnType<typeof this.repo.findAll>>): Promise<JunkCoinStatsResponse> {
    const [products, tickers, premium, meta] = await Promise.all([
      get<{ data: Product[] }>(PRODUCTS_URL).then((r) => r.data),
      get<Ticker[]>(`${FAPI()}/fapi/v1/ticker/24hr`),
      get<Premium[]>(`${FAPI()}/fapi/v1/premiumIndex`),
      this.loadMeta(),
    ]);
    const spot = new Map(products.filter((p) => p.q === 'USDT' && p.st === 'TRADING').map((p) => [p.s, p]));
    const t24 = new Map(tickers.map((t) => [t.symbol, t]));
    const prem = new Map(premium.map((p) => [p.symbol, p]));

    const today = Math.floor(Date.now() / DAY_MS);
    const stale = rows.filter((r) => this.closes.get(r.symbol)?.day !== today).map((r) => r.symbol);
    await mapLimit(stale, async (symbol) => {
      try {
        const k = await get<unknown[][]>(`${FAPI()}/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=92`);
        this.closes.set(symbol, { day: today, closes: k.slice(0, -1).map((r) => Number(r[4])) });
      } catch {
        /* leave the old closes (if any) — retried next read */
      }
    });

    // All-time high from weekly candles of both markets (spot history usually starts earlier).
    const athStale = rows.filter((r) => {
      const hit = this.ath.get(r.symbol);
      return !hit || Date.now() - hit.at > ATH_CACHE_MS;
    });
    await mapLimit(athStale, async (r) => {
      const weekly = async (url: string) => {
        try {
          return await get<unknown[][]>(url);
        } catch {
          return [];
        }
      };
      const [fut, sp] = await Promise.all([
        weekly(`${FAPI()}/fapi/v1/klines?symbol=${r.symbol}&interval=1w&limit=499`),
        spot.has(r.symbol) ? weekly(`${SPOT}/api/v3/klines?symbol=${r.symbol}&interval=1w&limit=1000`) : Promise.resolve([]),
      ]);
      let best = { price: 0, time: 0 };
      for (const k of [...fut, ...sp]) {
        const h = Number(k[2]);
        if (h > best.price) best = { price: h, time: Number(k[0]) };
      }
      if (best.price > 0) this.ath.set(r.symbol, { at: Date.now(), ...best });
    });

    // Spot listing date: first spot D1 candle, fetched once and stored.
    const missingListing = rows.filter((r) => !r.spotListedAt && spot.has(r.symbol));
    const listed = new Map<string, Date>();
    await mapLimit(missingListing, async (r) => {
      try {
        const k = await get<unknown[][]>(`${SPOT}/api/v3/klines?symbol=${r.symbol}&interval=1d&startTime=0&limit=1`);
        const t = Number(k[0]?.[0]);
        if (!Number.isFinite(t)) return;
        const at = new Date(t);
        listed.set(r.symbol, at);
        await this.repo.setSpotListedAt(r.symbol, at);
      } catch (err) {
        this.logger.warn(`spot listing date for ${r.symbol}: ${(err as Error).message}`);
      }
    });

    const stats = rows.map((r): JunkCoinStat => {
      const p = spot.get(r.symbol);
      const t = t24.get(r.symbol);
      const pr = prem.get(r.symbol);
      const price = t ? Number(t.lastPrice) : pr ? Number(pr.markPrice) : p ? Number(p.c) : null;
      const c = this.closes.get(r.symbol)?.closes ?? [];
      // N-day change = price now vs the close N daily candles back (the last closed candle is 1 back).
      const chg = (n: number) => (price && c.length >= n && c[c.length - n]! > 0 ? round((price / c[c.length - n]! - 1) * 100, 1) : null);
      const tags = p?.tags ?? [];
      const spotAt = r.spotListedAt ?? listed.get(r.symbol) ?? null;
      const onboard = meta.onboard.get(r.symbol);
      const athHit = this.ath.get(r.symbol);
      const ath = athHit ? (price && price > athHit.price ? { price, time: Date.now() } : athHit) : null;
      return {
        symbol: r.symbol,
        name: p?.an ?? null,
        price,
        marketCapUsd: p?.cs && price ? Math.round(p.cs * price) : null,
        quoteVolume24hUsd: t ? Math.round(Number(t.quoteVolume)) : null,
        change24hPct: t ? round(Number(t.priceChangePercent), 1) : null,
        change3dPct: chg(3),
        change7dPct: chg(7),
        change30dPct: chg(30),
        change90dPct: chg(90),
        athPrice: ath ? ath.price : null,
        athDate: ath ? new Date(ath.time).toISOString() : null,
        belowAthPct: ath && price ? round((1 - price / ath.price) * 100, 1) : null,
        fundingRatePct: pr ? round(Number(pr.lastFundingRate) * 100, 4) : null,
        fundingIntervalHours: meta.interval.get(r.symbol) ?? 8,
        nextFundingTime: pr?.nextFundingTime || null,
        ecosystems: [...new Set(tags.map((x) => ECOSYSTEM[x]).filter((x): x is string => !!x))],
        monitoring: tags.includes('Monitoring'),
        onSpot: !!p,
        spotListedAt: spotAt ? spotAt.toISOString() : null,
        futuresListedAt: onboard ? new Date(onboard).toISOString() : null,
      };
    });
    return { updatedAt: new Date().toISOString(), stats };
  }

  private async loadMeta() {
    if (this.meta && Date.now() - this.meta.at < META_CACHE_MS) return this.meta;
    const [info, funding] = await Promise.all([
      get<{ symbols: PerpSymbol[] }>(`${FAPI()}/fapi/v1/exchangeInfo`),
      get<FundingInfo[]>(`${FAPI()}/fapi/v1/fundingInfo`),
    ]);
    this.meta = {
      at: Date.now(),
      onboard: new Map(info.symbols.map((s) => [s.symbol, s.onboardDate])),
      interval: new Map(funding.map((f) => [f.symbol, f.fundingIntervalHours])),
    };
    return this.meta;
  }
}
