import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createSpotDailyScanRepository } from '@app/db';

import { watchlistSnapshot, type StrategyBHit } from '../chat/tools/tracking-coins.tool';

/**
 * Daily rule-based scan of the /tracking-coins watchlist for Strategy A and B (no LLM), shown as a
 * short summary under the page title. Runs 07:01 Vietnam time (00:01 UTC, right after the D1 close);
 * "Quét lại" on the page re-runs it and overwrites today's row.
 *
 * Rules mirror packages/skills/src/tracking-swing/strategies.ts:
 *   A — breadth ≥ 25% → volRank ≤ 100; 10–25% → volRank ≤ 50; < 10% → no new entries.
 *       rsiW < 35, listed ≥ 1y, not hot (RSI D1 ≤ 70 and 30d change < +30%). Ladder 30/30/40 at 0/−15/−35%, TP avg × 1.3.
 *   B — trigger in the last 2 closed D1 candles, price ≤ entry × 1.05. Grade CLIMAX → TP +15%, else +10%.
 *       Sell at the close of trigger day + 14. A coin that qualifies for A is listed under A only.
 */

export type SpotScanA = { symbol: string; rsiW: number; volRank: number; price: number; buy: [number, number, number] };
export type SpotScanB = {
  symbol: string;
  level: 'B' | 'B+';
  grade: StrategyBHit['grade'];
  entry: number;
  maxEntry: number;
  tp: number;
  tpPct: number;
  sellBy: string; // YYYY-MM-DD
  price: number;
};
export type SpotScanResult = {
  scannedAt: string;
  trigger: 'CRON' | 'MANUAL';
  breadthPct: number | null;
  regime: 'BUY' | 'TOP50' | 'NONE' | 'UNKNOWN';
  marketB: boolean;
  a: SpotScanA[];
  b: SpotScanB[];
  coins: number;
  /** Coins whose Binance data failed (skipped). */
  failed: string[];
};

const GRADE_RANK = { CLIMAX: 2, 'RÂU': 1, 'THƯỜNG': 0 } as const;
const round = (n: number) => Number(n.toPrecision(5));
const symOf = (pair: string) => pair.replace(/USDT$/, '');
/** YYYY-MM-DD in Vietnam time (UTC+7). */
const vnDate = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);

@Injectable()
export class SpotDailyScanService {
  private readonly logger = new Logger(SpotDailyScanService.name);
  private readonly repo = createSpotDailyScanRepository();
  private running: Promise<SpotScanResult> | null = null;

  @Cron('0 1 0 * * *', { timeZone: 'UTC' })
  async cron(): Promise<void> {
    try {
      const r = await this.run('CRON');
      this.logger.log(`Spot daily scan — A: ${r.a.map((x) => x.symbol).join(',') || '-'} · B: ${r.b.map((x) => x.symbol).join(',') || '-'}`);
    } catch (err) {
      this.logger.error(`Spot daily scan failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async latest(): Promise<SpotScanResult | null> {
    const row = await this.repo.latest();
    return (row?.payload as SpotScanResult | undefined) ?? null;
  }

  /** Scan now and store it as today's (VN date) scan. Concurrent calls share one run. */
  run(trigger: 'CRON' | 'MANUAL' = 'MANUAL'): Promise<SpotScanResult> {
    if (!this.running) {
      this.running = this.scan(trigger)
        .then(async (r) => {
          await this.repo.upsert(vnDate(new Date(r.scannedAt)), trigger, r);
          return r;
        })
        .finally(() => {
          this.running = null;
        });
    }
    return this.running;
  }

  private async scan(trigger: 'CRON' | 'MANUAL'): Promise<SpotScanResult> {
    const snap = await watchlistSnapshot();
    const now = new Date();
    const breadth = snap.mb ? snap.mb.pct : null;
    const regime: SpotScanResult['regime'] = breadth == null ? 'UNKNOWN' : breadth >= 25 ? 'BUY' : breadth >= 10 ? 'TOP50' : 'NONE';
    const maxRank = regime === 'BUY' ? 100 : regime === 'TOP50' ? 50 : 0;
    const failed = snap.coins.filter((c) => snap.rows.get(c.pair)?.price == null).map((c) => symOf(c.pair));

    const starsOf = new Map(snap.coins.map((c) => [symOf(c.pair), c.rating]));
    const rankOf = (sym: string) => snap.rank.get(`${sym}USDT`) ?? 999;
    const a: SpotScanA[] = [];
    for (const { pair, st } of snap.alts) {
      const rank = snap.rank.get(pair);
      if (!rank || rank > maxRank || st.price == null || st.rsiW == null || st.rsiW >= 35) continue;
      if ((st.rsiD != null && st.rsiD > 70) || (st.chg30 != null && st.chg30 >= 30)) continue; // hot — no chasing
      const p = st.price;
      a.push({ symbol: symOf(pair), rsiW: Math.round(st.rsiW * 10) / 10, volRank: rank, price: round(p), buy: [round(p), round(p * 0.85), round(p * 0.65)] });
    }
    a.sort((x, y) => x.rsiW - y.rsiW || (starsOf.get(y.symbol) ?? 0) - (starsOf.get(x.symbol) ?? 0));

    const inA = new Set(a.map((x) => x.symbol));
    const b: SpotScanB[] = [];
    for (const c of snap.coins) {
      const st = snap.rows.get(c.pair);
      const hit = st?.b;
      if (!st || !hit || st.price == null || hit.ago > 2 || inA.has(symOf(c.pair))) continue;
      if (st.price > hit.entry * 1.05) continue; // already bounced — missed it
      const tpPct = hit.grade === 'CLIMAX' ? 15 : 10;
      // Trigger candle = `ago` closed candles before the last closed one (yesterday UTC).
      const trigDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (1 + hit.ago) * 86_400_000);
      b.push({
        symbol: symOf(c.pair),
        level: hit.level,
        grade: hit.grade,
        entry: hit.entry,
        maxEntry: round(hit.entry * 1.05),
        tp: round(hit.entry * (1 + tpPct / 100)),
        tpPct,
        sellBy: new Date(trigDay.getTime() + 14 * 86_400_000).toISOString().slice(0, 10),
        price: round(st.price),
      });
    }
    b.sort(
      (x, y) =>
        GRADE_RANK[y.grade] - GRADE_RANK[x.grade] ||
        (y.level === 'B+' ? 1 : 0) - (x.level === 'B+' ? 1 : 0) ||
        (starsOf.get(y.symbol) ?? 0) - (starsOf.get(x.symbol) ?? 0) ||
        rankOf(x.symbol) - rankOf(y.symbol),
    );

    return {
      scannedAt: now.toISOString(),
      trigger,
      breadthPct: breadth == null ? null : Math.round(breadth * 10) / 10,
      regime,
      marketB: snap.marketB,
      a,
      b,
      coins: snap.coins.length,
      failed,
    };
  }
}
