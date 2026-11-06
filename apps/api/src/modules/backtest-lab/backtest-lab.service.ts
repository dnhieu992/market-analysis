import { spawn } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createBacktestRunRepository } from '@app/db';

import { compactTrade, computeStats, normalizeTrades, type BacktestStats, type NormalizedTrade } from './backtest-stats';
import { INTERVAL_MS, loadSeries, type KlineMarket, type SandboxCandle } from './kline-loader';
import { RUNNER_SOURCE } from './sandbox-runner';

const IMAGE = process.env.BACKTEST_SANDBOX_IMAGE ?? 'node:22-alpine';
/** Strategy code time limit inside the sandbox; the container itself is killed 20s later. */
const CODE_TIMEOUT_MS = 90_000;
const MAX_SYMBOLS = 20;
const MAX_INTERVALS = 4;
const MAX_DAYS = 1500;
/** Candles handed to one run, all series together (warm-up included). */
const MAX_TOTAL_CANDLES = 300_000;
/** Bars loaded BEFORE `fromMs` so indicators are warm when trading starts. */
const WARMUP_BARS = 300;
const CACHE_TTL_MS = 20 * 60_000;
const MAX_STDOUT_BYTES = 80 * 1024 * 1024;

export type BacktestSpec = {
  title: string;
  symbols: string[];
  intervals: string[];
  days: number;
  market?: KlineMarket;
  feePctPerSide?: number;
  capitalUsd?: number;
  params?: Record<string, unknown>;
  code: string;
};

export type BacktestRunResult =
  | {
      ok: true;
      runId: string;
      durationMs: number;
      data: Array<{ symbol: string; interval: string; market: string; candles: number; from: string; to: string }>;
      stats: BacktestStats;
      tradesTotal: number;
      invalidTrades: number;
      tradeErrors: string[];
      samples: { worstMae: unknown[]; worstPnl: unknown[]; latest: unknown[] };
      summary: unknown;
      logs: string[];
    }
  | { ok: false; runId: string | null; error: string; stack?: string; logs?: string[] };

type SandboxOutput =
  | { ok: true; result: { trades: unknown[] | null; tradesTotal: number | null; summary: unknown }; logs: string[] }
  | { ok: false; error: string; stack?: string; logs: string[] };

function pair(raw: string): string {
  const s = String(raw ?? '').trim().toUpperCase().replace(/-SWAP$/, '').replace(/[^A-Z0-9]/g, '');
  return s.endsWith('USDT') || s.endsWith('USDC') ? s : `${s}USDT`;
}

/** Walks up from a resolved file to the folder holding `package.json` with the given name. */
function packageRoot(fromFile: string, name: string): string | null {
  let dir = dirname(fromFile);
  for (let i = 0; i < 8; i++) {
    const pj = join(dir, 'package.json');
    if (existsSync(pj)) {
      try {
        if (JSON.parse(readFileSync(pj, 'utf8')).name === name) return dir;
      } catch {
        /* keep walking */
      }
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

/**
 * Runs strategy code written by an AI chat over Binance klines, inside a throw-away Docker container:
 * no network, no env, read-only root, uid 65534, all capabilities dropped, 512 MB / 1 CPU / 64 pids,
 * hard time limit. The API process (root, exchange keys) never executes the code itself.
 */
@Injectable()
export class BacktestLabService implements OnModuleInit {
  private readonly logger = new Logger(BacktestLabService.name);
  private readonly repo = createBacktestRunRepository();
  private readonly cache = new Map<string, { at: number; fromMs: number; market: KlineMarket; candles: SandboxCandle[] }>();
  private imageReady: Promise<boolean> | null = null;
  private busy: Promise<unknown> = Promise.resolve();
  private queued = 0;

  onModuleInit(): void {
    // Pull the sandbox image once in the background so the first /backtest doesn't wait for it.
    this.imageReady = this.ensureImage();
  }

  private exec(args: string[], input?: string, timeoutMs = 120_000): Promise<{ code: number | null; stdout: string; stderr: string; truncated: boolean }> {
    return new Promise((resolve, reject) => {
      const child = spawn('docker', args, { env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/root', ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}) } });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      let size = 0;
      let truncated = false;
      const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
      child.stdout.on('data', (b: Buffer) => {
        size += b.length;
        if (size > MAX_STDOUT_BYTES) {
          truncated = true;
          child.kill('SIGKILL');
          return;
        }
        out.push(b);
      });
      child.stderr.on('data', (b: Buffer) => {
        if (err.reduce((s, x) => s + x.length, 0) < 64_000) err.push(b);
      });
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), truncated });
      });
      child.stdin.on('error', () => undefined); // container died early — the close handler reports it
      if (input != null) child.stdin.end(input);
      else child.stdin.end();
    });
  }

  private async ensureImage(): Promise<boolean> {
    try {
      const inspect = await this.exec(['image', 'inspect', IMAGE], undefined, 30_000);
      if (inspect.code === 0) return true;
      this.logger.log(`Pulling backtest sandbox image ${IMAGE}…`);
      const pull = await this.exec(['pull', IMAGE], undefined, 300_000);
      if (pull.code !== 0) throw new Error(pull.stderr.trim().slice(0, 300));
      this.logger.log(`Backtest sandbox image ${IMAGE} ready`);
      return true;
    } catch (e) {
      this.logger.error(`Backtest sandbox image unavailable: ${e instanceof Error ? e.message : e}`);
      return false;
    }
  }

  private mounts(): string[] {
    const coreDir = realpathSync(dirname(require.resolve('@app/core')));
    const zodEntry = require.resolve('zod', { paths: [coreDir] });
    const zodDir = packageRoot(realpathSync(zodEntry), 'zod');
    const args = ['-v', `${coreDir}:/sandbox/core:ro`];
    if (zodDir) args.push('-v', `${zodDir}:/sandbox/node_modules/zod:ro`);
    return args;
  }

  /** One run at a time — the box has 2 vCPU and the pm2 apps need one. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    if (this.queued >= 2) return Promise.reject(new Error('Đang có 2 backtest khác chờ chạy — thử lại sau ít phút.'));
    this.queued++;
    const next = this.busy.then(fn, fn);
    this.busy = next.catch(() => undefined).finally(() => this.queued--);
    return next;
  }

  private async series(symbol: string, interval: string, fromMs: number, market: KlineMarket, max: number) {
    const key = `${symbol}|${interval}|${market}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS && hit.fromMs <= fromMs) {
      return { market: hit.market, candles: hit.candles.filter((c) => c.time >= fromMs) };
    }
    const s = await loadSeries(symbol, interval, fromMs, market, max);
    this.cache.set(key, { at: Date.now(), fromMs, market: s.market, candles: s.candles });
    // keep the cache small: drop expired entries, then the oldest beyond 40 series
    for (const [k, v] of this.cache) if (Date.now() - v.at > CACHE_TTL_MS) this.cache.delete(k);
    while (this.cache.size > 40) this.cache.delete(this.cache.keys().next().value as string);
    return { market: s.market, candles: s.candles };
  }

  validate(spec: BacktestSpec): string | null {
    if (!spec.code || spec.code.trim().length < 20) return 'Thiếu code chiến lược.';
    if (spec.code.length > 60_000) return 'Code quá dài (> 60k ký tự).';
    if (!spec.symbols?.length) return 'Cần ít nhất 1 symbol.';
    if (spec.symbols.length > MAX_SYMBOLS) return `Tối đa ${MAX_SYMBOLS} symbol mỗi lần chạy.`;
    if (!spec.intervals?.length) return 'Cần ít nhất 1 interval.';
    if (spec.intervals.length > MAX_INTERVALS) return `Tối đa ${MAX_INTERVALS} interval.`;
    const bad = spec.intervals.find((i) => !INTERVAL_MS[i]);
    if (bad) return `Interval không hỗ trợ: ${bad} (dùng ${Object.keys(INTERVAL_MS).join(', ')}).`;
    if (!(spec.days > 0 && spec.days <= MAX_DAYS)) return `days phải trong 1..${MAX_DAYS}.`;
    const est = spec.symbols.length * spec.intervals.reduce((s, i) => s + (spec.days * 86_400_000) / INTERVAL_MS[i]! + WARMUP_BARS, 0);
    if (est > MAX_TOTAL_CANDLES) {
      return `Quá nhiều nến (~${Math.round(est).toLocaleString('en-US')} > ${MAX_TOTAL_CANDLES.toLocaleString('en-US')}). Giảm số ngày / số coin, hoặc dùng khung lớn hơn.`;
    }
    return null;
  }

  async run(spec: BacktestSpec, meta: { conversationId?: string | null; skillId?: string | null }): Promise<BacktestRunResult> {
    const symbols = [...new Set(spec.symbols.map(pair))];
    const intervals = [...new Set(spec.intervals.map((i) => i.trim()))];
    const s: BacktestSpec = { ...spec, symbols, intervals };
    const invalid = this.validate(s);
    if (invalid) return { ok: false, runId: null, error: invalid };
    return this.serial(() => this.execute(s, meta));
  }

  private async execute(spec: BacktestSpec, meta: { conversationId?: string | null; skillId?: string | null }): Promise<BacktestRunResult> {
    const started = Date.now();
    const market: KlineMarket = spec.market === 'spot' ? 'spot' : 'futures';
    const feePctPerSide = spec.feePctPerSide ?? 0.05;
    const capitalUsd = spec.capitalUsd && spec.capitalUsd > 0 ? spec.capitalUsd : 1000;
    const fromMs = Date.now() - spec.days * 86_400_000;
    const persistSpec = (extra: Record<string, unknown> = {}) => ({
      symbols: spec.symbols,
      intervals: spec.intervals,
      days: spec.days,
      market,
      feePctPerSide,
      capitalUsd,
      params: (spec.params ?? null) as never,
      ...extra,
    });
    const fail = async (error: string, stack?: string, logs?: string[], extra: Record<string, unknown> = {}): Promise<BacktestRunResult> => {
      const row = await this.repo
        .create({
          ...meta,
          title: spec.title || 'Backtest',
          status: 'ERROR',
          spec: persistSpec(extra),
          code: spec.code,
          logs: logs?.length ? logs : null,
          error: [error, stack].filter(Boolean).join('\n').slice(0, 4000),
          durationMs: Date.now() - started,
        })
        .catch(() => null);
      return { ok: false, runId: row?.id ?? null, error, stack, logs };
    };

    if (!(await (this.imageReady ??= this.ensureImage()))) {
      this.imageReady = null; // retry the pull next time
      return fail(`Sandbox Docker chưa sẵn sàng (image ${IMAGE}). Kiểm tra docker trên VPS.`);
    }

    // ---- data ----
    const data: Record<string, Record<string, SandboxCandle[]>> = {};
    const sources: Array<{ symbol: string; interval: string; market: string; candles: number; from: string; to: string }> = [];
    try {
      for (const symbol of spec.symbols) {
        data[symbol] = {};
        for (const interval of spec.intervals) {
          const warmFrom = fromMs - WARMUP_BARS * INTERVAL_MS[interval]!;
          const max = Math.ceil((Date.now() - warmFrom) / INTERVAL_MS[interval]!) + 5;
          const sr = await this.series(symbol, interval, warmFrom, market, max);
          data[symbol]![interval] = sr.candles;
          const first = sr.candles[0];
          const last = sr.candles[sr.candles.length - 1];
          sources.push({
            symbol,
            interval,
            market: sr.market,
            candles: sr.candles.length,
            from: first ? new Date(first.time).toISOString().slice(0, 16) : '—',
            to: last ? new Date(last.closeTime).toISOString().slice(0, 16) : '—',
          });
        }
      }
    } catch (e) {
      return fail(`Lỗi tải dữ liệu: ${e instanceof Error ? e.message : String(e)}`);
    }

    // ---- sandbox ----
    const name = `backtest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const input = JSON.stringify({
      code: spec.code,
      timeoutMs: CODE_TIMEOUT_MS,
      ctx: {
        data,
        symbols: spec.symbols,
        intervals: spec.intervals,
        params: spec.params ?? {},
        fromMs,
        toMs: Date.now(),
        feePctPerSide,
        capitalUsd,
      },
    });
    let out: SandboxOutput;
    try {
      const res = await this.exec(
        [
          'run', '--rm', '-i', '--name', name,
          '--network', 'none',
          '--memory', '512m', '--memory-swap', '512m', '--cpus', '1', '--pids-limit', '64',
          '--read-only', '--tmpfs', '/tmp:rw,size=16m',
          '--user', '65534:65534', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
          ...this.mounts(),
          IMAGE, 'node', '--max-old-space-size=420', '-e', RUNNER_SOURCE,
        ],
        input,
        CODE_TIMEOUT_MS + 20_000,
      );
      if (res.code !== 0 || !res.stdout.trim()) {
        void this.exec(['rm', '-f', name], undefined, 15_000).catch(() => undefined);
        const why = res.truncated
          ? 'Kết quả trả về quá lớn (> 80MB) — trả ít lệnh / bớt dữ liệu thừa.'
          : res.code === 137 || res.code === null
            ? 'Sandbox bị dừng (quá thời gian hoặc quá 512MB RAM).'
            : `Sandbox lỗi (exit ${res.code}): ${res.stderr.trim().slice(-600)}`;
        return fail(why, undefined, undefined, { sources });
      }
      out = JSON.parse(res.stdout) as SandboxOutput;
    } catch (e) {
      return fail(`Không chạy được sandbox: ${e instanceof Error ? e.message : String(e)}`, undefined, undefined, { sources });
    }

    if (!out.ok) return fail(out.error, out.stack, out.logs, { sources });
    if (!Array.isArray(out.result.trades)) {
      return fail('Code phải `return { trades: [...] }` (mảng lệnh).', undefined, out.logs, { sources });
    }

    // ---- stats (in the API, not the sandbox) ----
    const finest: Record<string, SandboxCandle[]> = {};
    const smallest = [...spec.intervals].sort((a, b) => INTERVAL_MS[a]! - INTERVAL_MS[b]!)[0]!;
    for (const sym of spec.symbols) finest[sym] = data[sym]?.[smallest] ?? [];
    const norm = normalizeTrades(out.result.trades, { symbols: spec.symbols, finest, feePctPerSide });
    const inWindow: NormalizedTrade[] = [];
    let warmupTrades = 0;
    for (const t of norm.trades) {
      if (t.entryTime < fromMs) warmupTrades++;
      else inWindow.push(t);
    }
    const errors = [...norm.errors];
    if (warmupTrades) errors.push(`${warmupTrades} lệnh vào trước ctx.fromMs (giai đoạn warm-up) đã bị bỏ — chỉ vào lệnh khi candle.time >= ctx.fromMs.`);
    const stats = computeStats(inWindow, { capitalUsd });

    const byMae = [...inWindow].filter((t) => t.maePct != null).sort((a, b) => b.maePct! - a.maePct!).slice(0, 5).map(compactTrade);
    const byPnl = [...inWindow].sort((a, b) => a.pnlPct - b.pnlPct).slice(0, 5).map(compactTrade);
    const latest = [...inWindow].sort((a, b) => b.entryTime - a.entryTime).slice(0, 5).map(compactTrade);
    const durationMs = Date.now() - started;

    const row = await this.repo.create({
      ...meta,
      title: spec.title || 'Backtest',
      status: 'OK',
      spec: persistSpec({ sources, tradesTotal: out.result.tradesTotal, invalidTrades: norm.invalid + warmupTrades }),
      code: spec.code,
      stats: stats as never,
      trades: inWindow.sort((a, b) => a.entryTime - b.entryTime).slice(0, 3000).map(compactTrade) as never,
      logs: out.logs.length ? out.logs : null,
      durationMs,
    });

    return {
      ok: true,
      runId: row.id,
      durationMs,
      data: sources,
      stats,
      tradesTotal: out.result.tradesTotal ?? out.result.trades.length,
      invalidTrades: norm.invalid + warmupTrades,
      tradeErrors: errors,
      samples: { worstMae: byMae, worstPnl: byPnl, latest },
      summary: out.result.summary,
      logs: out.logs.slice(0, 40),
    };
  }

  getRun(id: string) {
    return this.repo.findById(id);
  }

  listRuns(opts: { take?: number; query?: string }) {
    return this.repo.listRecent(opts);
  }

  saveReport(id: string, report: string) {
    return this.repo.saveReport(id, report);
  }
}
