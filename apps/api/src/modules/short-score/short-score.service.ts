import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createChatSkillVersionRepository, createShortScoreSnapshotRepository } from '@app/db';

import { BacktestLabService } from '../backtest-lab/backtest-lab.service';
import { INTERVAL_MS } from '../backtest-lab/kline-loader';
import {
  DEFAULT_SCORE_SET,
  SCORE_SET_SKILL_ID,
  buildScoreCode,
  parseScoreSet,
  type CriterionResult,
  type ScoreSet,
} from './short-score.engine';

const DAY = 86_400_000;
/** Bars per interval loaded before the window and handed to each criterion (EMA200 on H4 needs them). */
const WARMUP_BARS = 1000;
const FNG_URL = 'https://api.alternative.me/fng/?limit=0&format=json';

export type ScoreCriterionView = { id: string; label: string; points: number; hit: boolean; detail: string | null; error?: string };

export type ShortScoreView = {
  symbol: string;
  takenAt: string;
  price: number | null;
  scorePct: number;
  hitPoints: number;
  maxPoints: number;
  criteriaVersion: number;
  trigger: string;
  criteria: ScoreCriterionView[];
};

export type ScoreSetView = { version: number; isDefault: boolean; updatedAt: string | null; note: string | null; set: ScoreSet };

type FngPoint = { time: number; value: number };

const round = (v: number, d = 1) => Number(v.toFixed(d));

/**
 * The user's SHORT checklist for BTC on the /trades OKX chat. The criteria set is a versioned JSON
 * document in chat_skill_versions (skillId `okx-short-score`, editable from the chat, no deploy);
 * scoring runs the criteria code in the backtest sandbox. A cron scores it every day at 12:05 VN.
 */
@Injectable()
export class ShortScoreService {
  private readonly logger = new Logger(ShortScoreService.name);
  private readonly versions = createChatSkillVersionRepository();
  private readonly snapshots = createShortScoreSnapshotRepository();
  private fng: { at: number; points: FngPoint[] } | null = null;

  constructor(private readonly lab: BacktestLabService) {}

  // ── criteria set ───────────────────────────────────────────────────────────

  async criteria(): Promise<ScoreSetView> {
    const row = await this.versions.latest(SCORE_SET_SKILL_ID);
    if (!row) return { version: 0, isDefault: true, updatedAt: null, note: null, set: DEFAULT_SCORE_SET };
    return { version: row.version, isDefault: false, updatedAt: row.createdAt.toISOString(), note: row.note, set: parseScoreSet(row.content) };
  }

  async history() {
    const rows = await this.versions.list(SCORE_SET_SKILL_ID);
    return rows.map((r) => ({ version: r.version, note: r.note, author: r.author, createdAt: r.createdAt.toISOString() }));
  }

  /**
   * Saves a new version after a dry run on live data: a syntax error or a criterion that throws is
   * rejected with the message, so a broken set never becomes current.
   */
  async updateCriteria(raw: unknown, note: string | null, author: 'USER' | 'LLM', conversationId?: string | null) {
    let set: ScoreSet;
    try {
      set = parseScoreSet(raw);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const cur = await this.criteria();
    const content = JSON.stringify(set, null, 2);
    if (!cur.isDefault && JSON.stringify(cur.set, null, 2) === content) throw new BadRequestException('Bộ tiêu chí giống hệt bản hiện tại.');
    const dry = await this.evaluateNow(set);
    const broken = dry.results.filter((r) => r.error);
    if (broken.length) {
      throw new BadRequestException(`Chạy thử lỗi — chưa lưu. ${broken.map((b) => `${b.id}: ${b.error}`).join(' | ')}`);
    }
    const row = await this.versions.append({ skillId: SCORE_SET_SKILL_ID, content, note, author, conversationId: conversationId ?? null });
    return { version: row.version, dryRun: this.toView(set, row.version, dry, 'CHAT') };
  }

  async rollback(version: number) {
    const row = await this.versions.findVersion(SCORE_SET_SKILL_ID, version);
    if (!row) throw new NotFoundException(`Không có version ${version} của bộ tiêu chí.`);
    return this.updateCriteria(row.content, `Khôi phục từ v${version}`, 'USER');
  }

  // ── scoring ────────────────────────────────────────────────────────────────

  private async fearGreed(): Promise<FngPoint[]> {
    if (this.fng && Date.now() - this.fng.at < 60 * 60_000) return this.fng.points;
    try {
      const res = await fetch(FNG_URL, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data?: Array<{ value: string; timestamp: string }> };
      const points = (body.data ?? [])
        .map((x) => ({ time: Number(x.timestamp) * 1000, value: Number(x.value) }))
        .filter((x) => Number.isFinite(x.time) && Number.isFinite(x.value))
        .sort((a, b) => a.time - b.time);
      if (!points.length) throw new Error('empty');
      this.fng = { at: Date.now(), points };
      return points;
    } catch (e) {
      this.logger.warn(`Fear & Greed unavailable: ${(e as Error).message}`);
      return this.fng?.points ?? [];
    }
  }

  private fine(set: ScoreSet): string {
    return [...set.intervals].sort((a, b) => INTERVAL_MS[a]! - INTERVAL_MS[b]!)[0]!;
  }

  private async evaluateNow(set: ScoreSet): Promise<{ t: number; price: number | null; results: CriterionResult[] }> {
    const now = Date.now();
    const fng = (await this.fearGreed()).filter((p) => p.time >= now - 120 * DAY);
    const r = await this.lab.evaluate({
      symbols: [set.symbol],
      intervals: set.intervals,
      days: 2,
      warmupBars: WARMUP_BARS,
      params: { mode: 'now', at: [now], maxBars: WARMUP_BARS, fine: this.fine(set), fng },
      code: buildScoreCode(set),
    });
    if (!r.ok) throw new BadRequestException(`Không chấm được điểm: ${r.error}${r.stack ? `\n${r.stack}` : ''}`);
    return r.summary as { t: number; price: number | null; results: CriterionResult[] };
  }

  private toView(set: ScoreSet, version: number, r: { t: number; price: number | null; results: CriterionResult[] }, trigger: string): ShortScoreView {
    const byId = new Map(r.results.map((x) => [x.id, x]));
    const criteria = set.criteria
      .filter((c) => c.enabled !== false)
      .map((c) => {
        const x = byId.get(c.id);
        return { id: c.id, label: c.label, points: c.points, hit: Boolean(x?.hit), detail: x?.detail ?? null, ...(x?.error ? { error: x.error } : {}) };
      });
    const maxPoints = criteria.reduce((s, c) => s + c.points, 0);
    const hitPoints = criteria.reduce((s, c) => s + (c.hit ? c.points : 0), 0);
    return {
      symbol: set.symbol,
      takenAt: new Date(r.t).toISOString(),
      price: r.price,
      scorePct: maxPoints ? round((hitPoints / maxPoints) * 100) : 0,
      hitPoints,
      maxPoints,
      criteriaVersion: version,
      trigger,
      criteria,
    };
  }

  /** Scores now with the current set and stores a snapshot. */
  async scoreNow(trigger: 'CRON' | 'CHAT' | 'UI'): Promise<ShortScoreView> {
    const cur = await this.criteria();
    const r = await this.evaluateNow(cur.set);
    const view = this.toView(cur.set, cur.version, r, trigger);
    await this.snapshots
      .create({
        symbol: view.symbol,
        takenAt: new Date(view.takenAt),
        scorePct: view.scorePct,
        hitPoints: view.hitPoints,
        maxPoints: view.maxPoints,
        criteriaVersion: view.criteriaVersion,
        price: view.price,
        results: view.criteria as never,
        trigger,
      })
      .catch((e) => this.logger.warn(`snapshot not saved: ${(e as Error).message}`));
    return view;
  }

  async latest(symbol?: string): Promise<ShortScoreView | null> {
    const sym = symbol ?? (await this.criteria()).set.symbol;
    const row = await this.snapshots.latest(sym);
    if (!row) return null;
    return {
      symbol: row.symbol,
      takenAt: row.takenAt.toISOString(),
      price: row.price,
      scorePct: row.scorePct,
      hitPoints: row.hitPoints,
      maxPoints: row.maxPoints,
      criteriaVersion: row.criteriaVersion,
      trigger: row.trigger,
      criteria: row.results as unknown as ScoreCriterionView[],
    };
  }

  async recent(take = 14) {
    const sym = (await this.criteria()).set.symbol;
    const rows = await this.snapshots.list(sym, take);
    return rows.map((r) => ({ takenAt: r.takenAt.toISOString(), scorePct: r.scorePct, hitPoints: r.hitPoints, maxPoints: r.maxPoints, price: r.price, version: r.criteriaVersion, trigger: r.trigger }));
  }

  /** 12:05 Vietnam time = 05:05 UTC, after the morning window the default set looks at. */
  @Cron('0 5 5 * * *', { timeZone: 'UTC' })
  async dailyScore(): Promise<void> {
    try {
      const v = await this.scoreNow('CRON');
      this.logger.log(`Daily short score ${v.symbol}: ${v.scorePct}% (${v.hitPoints}/${v.maxPoints})`);
    } catch (e) {
      this.logger.error(`Daily short score failed: ${(e as Error).message}`);
    }
  }

  // ── history ────────────────────────────────────────────────────────────────

  /**
   * Scores the CURRENT (or a proposed) set once per day at `hourVn` over the past `days`, and
   * compares each score level with what happened next: from that price, was −m% (short wins)
   * or +m% (long wins) touched first.
   */
  async backtest(opts: { days?: number; hourVn?: number; moves?: number[]; set?: unknown }) {
    const set = opts.set != null ? parseScoreSet(opts.set) : (await this.criteria()).set;
    const days = Math.min(Math.max(Math.round(opts.days ?? 365), 30), 1000);
    const hourVn = Math.min(Math.max(Math.round(opts.hourVn ?? 12), 0), 23);
    const moves = (opts.moves?.length ? opts.moves : [1, 2, 3]).map(Number).filter((m) => m > 0 && m <= 20).slice(0, 4);
    const now = Date.now();
    const hourUtc = (((hourVn - 7) % 24) + 24) % 24;
    const at: number[] = [];
    for (let k = days; k >= 1; k--) {
      const t = Math.floor((now - k * DAY) / DAY) * DAY + hourUtc * 3_600_000 + 5 * 60_000;
      if (t < now - 3_600_000) at.push(t);
    }
    const fng = (await this.fearGreed()).filter((p) => p.time >= now - (days + 120) * DAY);
    const r = await this.lab.evaluate({
      symbols: [set.symbol],
      intervals: set.intervals,
      days: days + 1,
      warmupBars: WARMUP_BARS,
      params: { mode: 'history', at, maxBars: WARMUP_BARS, fine: this.fine(set), fng, moves },
      code: buildScoreCode(set),
    });
    if (!r.ok) throw new BadRequestException(`Backtest lỗi: ${r.error}${r.stack ? `\n${r.stack}` : ''}`);
    const s = r.summary as { ids: string[]; rows: Array<{ t: number; price: number; hits: number[]; out: Array<1 | -1 | null> }>; errors: Record<string, string> };
    const crits = set.criteria.filter((c) => c.enabled !== false);
    const pts = s.ids.map((id) => crits.find((c) => c.id === id)?.points ?? 1);
    const maxPoints = pts.reduce((a, b) => a + b, 0);

    const shortWin = (rows: typeof s.rows, mi: number) => {
      const dec = rows.filter((x) => x.out[mi] != null);
      return dec.length ? { n: dec.length, pct: round((dec.filter((x) => x.out[mi] === 1).length / dec.length) * 100) } : { n: 0, pct: null };
    };
    const scoreOf = (x: (typeof s.rows)[number]) => x.hits.reduce((a, h, i) => a + (h === 1 ? pts[i]! : 0), 0);

    const levels = [...new Set(s.rows.map(scoreOf))].sort((a, b) => a - b);
    const byScore = levels.map((lv) => {
      const rows = s.rows.filter((x) => scoreOf(x) === lv);
      return { points: lv, scorePct: round((lv / maxPoints) * 100), days: rows.length, shortWin: moves.map((m, mi) => ({ move: m, ...shortWin(rows, mi) })) };
    });
    const byCriterion = s.ids.map((id, i) => {
      const yes = s.rows.filter((x) => x.hits[i] === 1);
      const no = s.rows.filter((x) => x.hits[i] === 0);
      return {
        id,
        label: crits.find((c) => c.id === id)?.label ?? id,
        daysHit: yes.length,
        shortWinWhenHit: moves.map((m, mi) => ({ move: m, ...shortWin(yes, mi) })),
        shortWinWhenNot: moves.map((m, mi) => ({ move: m, ...shortWin(no, mi) })),
        ...(s.errors[id] ? { firstError: s.errors[id] } : {}),
      };
    });
    return {
      symbol: set.symbol,
      days: s.rows.length,
      from: s.rows[0] ? new Date(s.rows[0].t).toISOString().slice(0, 10) : null,
      to: s.rows.length ? new Date(s.rows[s.rows.length - 1]!.t).toISOString().slice(0, 10) : null,
      hourVn,
      maxPoints,
      base: moves.map((m, mi) => ({ move: m, ...shortWin(s.rows, mi) })),
      byScore,
      byCriterion,
      durationMs: r.durationMs,
    };
  }
}
