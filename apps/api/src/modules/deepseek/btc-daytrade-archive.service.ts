import { Injectable, Logger } from '@nestjs/common';
import { createBtcDaytradeAnalysisRepository } from '@app/db';

import { StorageService } from '../storage/storage.service';
import type { BtcPaSnapshot } from './btc-pa-snapshot.service';
import type { BtcDaytradeResult, DaytradeSignal } from './deepseek.service';

/**
 * The daily log behind the BTC day-trading agent: one row per calendar day,
 * overwritten every time Analyze is pressed that day, plus the chart PNG in R2.
 *
 * The day is the **Vietnam** calendar day (UTC+7). A run at 01:00 Vietnam time
 * belongs to that morning's log, not to the previous UTC day, which is what a
 * naive `new Date()` in UTC would file it under.
 *
 * The chart object key is derived from the date alone, so re-running overwrites
 * the same object in R2 instead of leaving a trail of orphans nobody deletes.
 */

const CHART_PREFIX = 'deepseek/btc-daytrade';
const VN_OFFSET_MS = 7 * 3600_000;

/** A stored day, in the shape the API hands to the UI. */
export type StoredDaytradeAnalysis = BtcDaytradeResult & {
  /** Vietnam calendar day, `YYYY-MM-DD`. */
  date: string;
  chartUrl: string | null;
  /** How many times Analyze has been pressed on this day. */
  runCount: number;
};

/** One row of the history strip — no heavy JSON. */
export type DaytradeHistoryItem = {
  date: string;
  direction: string;
  confidence: string | null;
  riskReward: number | null;
  summary: string | null;
  chartUrl: string | null;
  runCount: number;
  generatedAt: string;
};

/** `YYYY-MM-DD` for the Vietnam calendar day containing `at`. */
export function vnDateKey(at: Date = new Date()): string {
  return new Date(at.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * The DATE value stored for a `YYYY-MM-DD` key: UTC midnight of that day. MySQL
 * DATE columns carry no timezone, so the value has to be pinned to UTC midnight
 * or Prisma will shift it by the process timezone on the way back out.
 */
export function dateKeyToDate(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

/** The inverse: a stored DATE back to its `YYYY-MM-DD` key, with no shifting. */
export function dateToKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const parseJson = <T>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

@Injectable()
export class BtcDaytradeArchiveService {
  private readonly logger = new Logger(BtcDaytradeArchiveService.name);
  private readonly repo = createBtcDaytradeAnalysisRepository();

  constructor(private readonly storage: StorageService) {}

  /**
   * Upload the chart (best-effort) and upsert the day's row.
   *
   * Neither R2 nor MySQL is allowed to sink a finished analysis: if the upload
   * or the write fails the caller still gets its result, just without a chart
   * URL or without having been logged. Losing the log is bad; throwing away an
   * answer the user already paid tokens for is worse.
   */
  async save(
    result: BtcDaytradeResult,
    chart: Buffer | null,
  ): Promise<StoredDaytradeAnalysis> {
    const date = vnDateKey(new Date(result.generatedAt));
    const chartUrl = chart ? await this.uploadChart(date, chart) : null;
    const signal = result.signal;

    try {
      const row = await this.repo.upsertByDate({
        date: dateKeyToDate(date),
        direction: signal?.direction ?? 'NO_TRADE',
        confidence: signal?.confidence ?? null,
        entryFrom: signal?.entryFrom ?? null,
        entryTo: signal?.entryTo ?? null,
        stopLoss: signal?.stopLoss ?? null,
        takeProfitsJson: signal ? JSON.stringify(signal.takeProfits) : null,
        riskReward: signal?.riskReward ?? null,
        riskPct: signal?.riskPct ?? null,
        timeframeBiasJson: signal ? JSON.stringify(signal.timeframeBias) : null,
        invalidation: signal?.invalidation ?? null,
        summary: signal?.summary ?? null,
        warningsJson: signal ? JSON.stringify(signal.warnings) : null,
        analysis: result.analysis,
        reasoning: result.reasoning,
        model: result.model,
        price: result.snapshot.price,
        snapshotJson: JSON.stringify(result.snapshot),
        usageJson: result.usage ? JSON.stringify(result.usage) : null,
        chartUrl,
        chartObjectKey: chartUrl ? this.objectKey(date) : null,
        capturedAt: new Date(result.snapshot.capturedAt),
        generatedAt: new Date(result.generatedAt),
      });
      this.logger.log(
        `Stored BTC day-trade analysis for ${date} (${row.direction}, lần chạy thứ ${row.runCount})`,
      );
      return { ...result, date, chartUrl, runCount: row.runCount };
    } catch (err) {
      this.logger.error(
        `Failed to store the BTC day-trade analysis for ${date}: ${(err as Error).message}`,
      );
      return { ...result, date, chartUrl, runCount: 1 };
    }
  }

  /** The stored analysis for a Vietnam calendar day, or null if that day has none. */
  async findByDate(date: string): Promise<StoredDaytradeAnalysis | null> {
    const row = await this.repo.findByDate(dateKeyToDate(date));
    if (!row) return null;

    // `warningsJson` is written for every parsed signal (an empty array at
    // minimum), so its absence is exactly the "model returned no JSON" case.
    const signal: DaytradeSignal | null =
      row.warningsJson == null
        ? null
        : {
            direction: row.direction as DaytradeSignal['direction'],
            confidence: row.confidence as DaytradeSignal['confidence'],
            entryFrom: row.entryFrom,
            entryTo: row.entryTo,
            stopLoss: row.stopLoss,
            takeProfits: parseJson<number[]>(row.takeProfitsJson, []),
            // Not stored: the model's own claim only matters while checking it.
            riskRewardModel: null,
            riskReward: row.riskReward,
            riskPct: row.riskPct,
            timeframeBias: parseJson<DaytradeSignal['timeframeBias']>(row.timeframeBiasJson, {}),
            invalidation: row.invalidation,
            summary: row.summary,
            warnings: parseJson<string[]>(row.warningsJson, []),
          };

    return {
      date: dateToKey(row.date),
      analysis: row.analysis,
      signal,
      reasoning: row.reasoning,
      model: row.model,
      generatedAt: row.generatedAt.toISOString(),
      snapshot: parseJson<BtcPaSnapshot>(row.snapshotJson, {} as BtcPaSnapshot),
      usage: parseJson<BtcDaytradeResult['usage']>(row.usageJson, null),
      chartUrl: row.chartUrl,
      runCount: row.runCount,
    };
  }

  /** Today's stored analysis (Vietnam time), or null before the first run of the day. */
  today(): Promise<StoredDaytradeAnalysis | null> {
    return this.findByDate(vnDateKey());
  }

  async history(limit = 30): Promise<DaytradeHistoryItem[]> {
    const rows = await this.repo.listRecent(limit);
    return rows.map((row) => ({
      // `row.date` is already UTC midnight of the Vietnam day — formatting it
      // directly is what keeps the key stable; re-applying the offset here would
      // push every row forward by a day.
      date: dateToKey(row.date),
      direction: row.direction,
      confidence: row.confidence,
      riskReward: row.riskReward,
      summary: row.summary,
      chartUrl: row.chartUrl,
      runCount: row.runCount,
      generatedAt: row.generatedAt.toISOString(),
    }));
  }

  private objectKey(date: string): string {
    return `${CHART_PREFIX}/${date}.png`;
  }

  /** Upload the PNG under the day's stable key. Returns null when R2 is off or fails. */
  private async uploadChart(date: string, chart: Buffer): Promise<string | null> {
    if (!this.storage.enabled) {
      this.logger.warn('R2 is not configured — the day-trade chart will not be attached.');
      return null;
    }
    try {
      const stored = await this.storage.uploadFile(
        {
          buffer: chart,
          mimetype: 'image/png',
          originalname: `btc-daytrade-${date}.png`,
          size: chart.length,
        },
        this.objectKey(date),
      );
      return stored.url;
    } catch (err) {
      this.logger.warn(`Failed to upload the day-trade chart: ${(err as Error).message}`);
      return null;
    }
  }
}
