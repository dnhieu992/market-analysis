import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { scanJunkShorts, type JunkCandidate } from '@app/core';
import { createJunkShortCoinRepository, createJunkShortDailyScanRepository } from '@app/db';

/**
 * Daily rule-based scan of the /short-junk list (no LLM), shown as a one-glance summary under the page
 * title. Runs 07:02 Vietnam time (00:02 UTC, right after the D1 close — setup A = short at the new open);
 * "Quét lại" on the page re-runs it and overwrites today's row. Same scan as the chat tool / Telegram alert.
 *
 * Rules mirror packages/skills/src/short-junk/system.ts:
 *   A (pump fade, ≥ +50%/3D)  — always listed. Ladder 0/+30/+60%, stop +100%, TP avg −20%, 30 days.
 *   B (EMA bounce)            — only when BTC D1 < EMA50. Ladder 0/+15/+30%, stop +50%, TP avg −10%, 20 days.
 *   WATCH (+30–50%/3D)        — watch only, no entry.
 *   Futures listed < 90 days → watch only. Red flags (failed study gate, Monitoring tag, funding ≤ −0.1%,
 *   thin pump volume < 2× on A, cap before pump < $30M) → half size.
 */

export type JunkScanShort = {
  symbol: string;
  setup: 'A' | 'B';
  action: 'SHORT' | 'HALF' | 'WATCH';
  pump3dPct: number;
  price: number;
  entries: number[];
  stop: number;
  tpPct: number;
  days: number;
  flags: string[];
};
export type JunkScanResult = {
  scannedAt: string;
  trigger: 'CRON' | 'MANUAL';
  btc: { bear: boolean; close: number; ema50: number };
  short: JunkScanShort[];
  watch: Array<{ symbol: string; pump3dPct: number }>;
  coins: number;
  /** Listed coins with no trading Binance USDT-M perp. */
  notOnFutures: string[];
};

const vnDate = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const bare = (s: string) => s.replace(/USDT$/, '');

/** Short Vietnamese label for a study-gate warning from the core scan. */
function warnLabel(w: string): string {
  if (w.startsWith('not on Binance spot')) return 'không có spot';
  if (w.startsWith('no market-cap')) return 'thiếu vốn hoá';
  if (w.startsWith('futures listed')) return 'list < 90 ngày';
  if (w.startsWith('cap before pump <')) return 'cap trước pump < $20M';
  if (w.startsWith('cap before pump >')) return 'cap trước pump > $500M';
  const m = /^only (\d+)% below ATH/.exec(w);
  if (m) return `chỉ −${m[1]}% so với ATH`;
  return w;
}

export function toShort(c: JunkCandidate): JunkScanShort {
  const a = c.setup === 'A_PUMP_FADE';
  const flags = [...new Set(c.warnings.map(warnLabel))];
  if (c.monitoringTag) flags.push('Monitoring');
  if (c.fundingPct <= -0.1) flags.push(`funding ${c.fundingPct}%`);
  if (a && c.volumeX20d < 2) flags.push(`vol pump ${c.volumeX20d}×`);
  if (c.capBeforePumpUsdM < 30 && !flags.some((f) => f.startsWith('cap trước pump <'))) flags.push(`cap trước pump $${c.capBeforePumpUsdM}M`);
  const tooNew = c.listingDays < 90;
  if (tooNew && !flags.includes('list < 90 ngày')) flags.push('list < 90 ngày');
  return {
    symbol: bare(c.symbol),
    setup: a ? 'A' : 'B',
    action: tooNew ? 'WATCH' : flags.length ? 'HALF' : 'SHORT',
    pump3dPct: c.pump3dPct,
    price: c.price,
    entries: c.plan.entries,
    stop: c.plan.hardStop,
    tpPct: a ? 20 : 10,
    days: c.plan.timeStopDays,
    flags,
  };
}

const ACTION_RANK = { SHORT: 0, HALF: 1, WATCH: 2 } as const;

@Injectable()
export class JunkShortDailyScanService {
  private readonly logger = new Logger(JunkShortDailyScanService.name);
  private readonly repo = createJunkShortDailyScanRepository();
  private readonly coinRepo = createJunkShortCoinRepository();
  private running: Promise<JunkScanResult> | null = null;

  @Cron('0 2 0 * * *', { timeZone: 'UTC' })
  async cron(): Promise<void> {
    try {
      const r = await this.run('CRON');
      this.logger.log(`Junk-short daily scan — short: ${r.short.map((x) => `${x.symbol}(${x.setup})`).join(',') || '-'} · watch: ${r.watch.map((x) => x.symbol).join(',') || '-'}`);
    } catch (err) {
      this.logger.error(`Junk-short daily scan failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async latest(): Promise<JunkScanResult | null> {
    const row = await this.repo.latest();
    return (row?.payload as JunkScanResult | undefined) ?? null;
  }

  /** Scan now and store it as today's (VN date) scan. Concurrent calls share one run. */
  run(trigger: 'CRON' | 'MANUAL' = 'MANUAL'): Promise<JunkScanResult> {
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

  private async scan(trigger: 'CRON' | 'MANUAL'): Promise<JunkScanResult> {
    const symbols = await this.coinRepo.symbols();
    const now = new Date();
    if (symbols.length === 0) {
      return { scannedAt: now.toISOString(), trigger, btc: { bear: false, close: 0, ema50: 0 }, short: [], watch: [], coins: 0, notOnFutures: [] };
    }
    const scan = await scanJunkShorts({ fapiBaseUrl: process.env.BINANCE_FAPI_BASE_URL, symbols, topGainers: 0 });
    const bear = scan.btc.bear;
    const short = scan.candidates
      .filter((c) => c.setup === 'A_PUMP_FADE' || (c.setup === 'B_EMA_BOUNCE' && bear))
      .map(toShort)
      .sort((x, y) => (x.setup === y.setup ? 0 : x.setup === 'A' ? -1 : 1) || ACTION_RANK[x.action] - ACTION_RANK[y.action] || y.pump3dPct - x.pump3dPct);
    const watch = scan.candidates
      .filter((c) => c.setup === 'WATCH_PUMP')
      .map((c) => ({ symbol: bare(c.symbol), pump3dPct: c.pump3dPct }))
      .sort((x, y) => y.pump3dPct - x.pump3dPct);
    return {
      scannedAt: now.toISOString(),
      trigger,
      btc: { bear, close: scan.btc.close, ema50: scan.btc.ema50D1 },
      short,
      watch,
      coins: symbols.length,
      notOnFutures: scan.universe.notOnBinanceFutures.map(bare),
    };
  }
}
