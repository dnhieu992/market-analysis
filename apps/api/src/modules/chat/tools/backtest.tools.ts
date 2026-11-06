import { Injectable } from '@nestjs/common';

import { BacktestLabService, type BacktestSpec } from '../../backtest-lab/backtest-lab.service';
import type { ChatTool } from '../contracts/chat-tool';

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String).filter(Boolean) : typeof v === 'string' ? v.split(/[,\s]+/).filter(Boolean) : [];

function objParam(v: unknown): Record<string, unknown> | undefined {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === 'string' && v.trim()) {
    try {
      const o = JSON.parse(v);
      return o && typeof o === 'object' && !Array.isArray(o) ? o : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

const j = (v: unknown) => JSON.stringify(v);

/**
 * "/backtest" in the AI chats: the model writes the strategy as JS, `run_backtest` runs it in the
 * Docker sandbox (BacktestLabService) and returns API-computed stats; the write-up is stored with
 * `save_backtest_report`. Which chats get these tools is decided by each skill's `tools` list.
 */
@Injectable()
export class BacktestChatService {
  constructor(private readonly lab: BacktestLabService) {}

  tools(): ChatTool[] {
    return [this.runTool(), this.saveReportTool(), this.listTool(), this.getTool()] as ChatTool[];
  }

  private runTool(): ChatTool<Record<string, unknown>, string> {
    return {
      name: 'run_backtest',
      description:
        'Run a strategy backtest on Binance klines in an isolated sandbox. `code` is the BODY of a synchronous function (ctx, ta, core) that must ' +
        '`return { trades: [...] }` — see the Backtest section of the system prompt for the contract. Stats (fees, win rate, drawdown, MAE) are ' +
        'computed by the server from the returned trades. Every run is saved and gets a runId. On error, fix the code and call again.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short name of the strategy + variant, e.g. "Short pump-fade H4 TP 5%"' },
          symbols: { type: 'array', items: { type: 'string' }, description: 'Binance pairs, e.g. ["BTCUSDT","ETHUSDT"] (max 20)' },
          intervals: { type: 'array', items: { type: 'string' }, description: 'Candle intervals to load, e.g. ["4h","1d"] (max 4). The smallest is used for MAE.' },
          days: { type: 'number', description: 'History length in days (trading window; 300 warm-up bars are added before it)' },
          market: { type: 'string', description: "'futures' (default, falls back to spot when no perp) or 'spot'" },
          feePctPerSide: { type: 'number', description: 'Fee % per side, default 0.05' },
          capitalUsd: { type: 'number', description: 'Capital for return % / drawdown %, default 1000' },
          params: { type: 'object', description: 'Optional JSON object exposed as ctx.params (use it for the knobs you sweep)' },
          code: { type: 'string', description: 'JS function body (synchronous). Must return { trades: [...] , summary? }' },
        },
        required: ['title', 'symbols', 'intervals', 'days', 'code'],
      },
      execute: async (input, context) => {
        const spec: BacktestSpec = {
          title: String(input?.title ?? 'Backtest').slice(0, 200),
          symbols: strList(input?.symbols),
          intervals: strList(input?.intervals),
          days: Number(input?.days),
          market: input?.market === 'spot' ? 'spot' : 'futures',
          feePctPerSide: input?.feePctPerSide != null && Number.isFinite(Number(input.feePctPerSide)) ? Number(input.feePctPerSide) : undefined,
          capitalUsd: input?.capitalUsd != null && Number.isFinite(Number(input.capitalUsd)) ? Number(input.capitalUsd) : undefined,
          params: objParam(input?.params),
          code: String(input?.code ?? ''),
        };
        const r = await this.lab.run(spec, { conversationId: context?.conversationId ?? null, skillId: context?.skillId ?? null });
        if (!r.ok) {
          return [
            `❌ Backtest lỗi${r.runId ? ` (runId ${r.runId})` : ''}: ${r.error}`,
            r.stack ? `Stack (dòng tính theo code của bạn):\n${r.stack}` : '',
            r.logs?.length ? `ctx.log:\n${r.logs.slice(0, 30).join('\n')}` : '',
            'Sửa code / tham số rồi gọi lại run_backtest.',
          ]
            .filter(Boolean)
            .join('\n\n');
        }
        return [
          `✅ Backtest xong — runId ${r.runId} (${(r.durationMs / 1000).toFixed(1)}s)`,
          `Dữ liệu: ${r.data.map((d) => `${d.symbol} ${d.interval} ${d.market} ${d.candles} nến ${d.from}→${d.to}`).join(' · ')}`,
          `Lệnh code trả về: ${r.tradesTotal} · không hợp lệ/bị bỏ: ${r.invalidTrades}`,
          r.tradeErrors.length ? `Lỗi lệnh:\n${r.tradeErrors.join('\n')}` : '',
          `Thống kê (server tính, phí ${spec.feePctPerSide ?? 0.05}%/chiều, lệnh đã đóng; open = lệnh còn mở cuối dữ liệu, định giá theo giá đóng cuối):\n${j(r.stats)}`,
          `Lệnh MAE tệ nhất: ${j(r.samples.worstMae)}`,
          `Lệnh lỗ nhất: ${j(r.samples.worstPnl)}`,
          `Lệnh gần nhất: ${j(r.samples.latest)}`,
          r.summary != null ? `summary từ code: ${j(r.summary).slice(0, 3000)}` : '',
          r.logs.length ? `ctx.log:\n${r.logs.join('\n')}` : '',
          'Nếu số lệnh = 0 hoặc kết quả vô lý → kiểm tra lại code trước khi kết luận. Xong thì viết báo cáo và gọi save_backtest_report.',
        ]
          .filter(Boolean)
          .join('\n\n');
      },
    };
  }

  private saveReportTool(): ChatTool<{ runId: string; report: string }, string> {
    return {
      name: 'save_backtest_report',
      description:
        'Save the Markdown write-up of a backtest run (strategy rules as tested, assumptions, results table, takeaway). Call once per finished ' +
        'backtest — for a parameter sweep, save on the best/main run and list the other runIds in the report.',
      inputSchema: {
        type: 'object',
        properties: {
          runId: { type: 'string' },
          report: { type: 'string', description: 'Markdown report (Vietnamese)' },
        },
        required: ['runId', 'report'],
      },
      execute: async (input) => {
        const id = String(input?.runId ?? '').trim();
        const report = String(input?.report ?? '').trim();
        if (!id || report.length < 30) return 'Cần runId và nội dung report.';
        const run = await this.lab.getRun(id);
        if (!run) return `Không có run ${id}.`;
        await this.lab.saveReport(id, report.slice(0, 60_000));
        return `Đã lưu báo cáo cho run ${id} (“${run.title}”).`;
      },
    };
  }

  private listTool(): ChatTool<{ limit?: number; query?: string }, string> {
    return {
      name: 'list_backtest_runs',
      description: 'List recent backtest runs (newest first) with their key stats — use it to recall or compare earlier backtests.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'default 15, max 50' },
          query: { type: 'string', description: 'Filter by text in the title' },
        },
      },
      execute: async (input) => {
        const rows = await this.lab.listRuns({ take: Number(input?.limit) || 15, query: input?.query ? String(input.query) : undefined });
        if (!rows.length) return 'Chưa có backtest nào.';
        return j(
          rows.map((r) => {
            const st = r.stats as { closed?: Record<string, unknown>; mae?: Record<string, unknown> } | null;
            const sp = r.spec as Record<string, unknown>;
            return {
              runId: r.id,
              at: r.createdAt.toISOString().slice(0, 16),
              title: r.title,
              status: r.status,
              symbols: sp?.symbols,
              intervals: sp?.intervals,
              days: sp?.days,
              ...(st?.closed
                ? {
                    trades: st.closed.trades,
                    winRatePct: st.closed.winRatePct,
                    netPnlUsd: st.closed.netPnlUsd,
                    maxDrawdownPct: st.closed.maxDrawdownPct,
                    maxMaePct: st.mae?.maxPct,
                  }
                : {}),
              ...(r.error ? { error: r.error.slice(0, 120) } : {}),
              hasReport: Boolean(r.reportAt),
            };
          }),
        );
      },
    };
  }

  private getTool(): ChatTool<{ runId: string; includeTrades?: boolean }, string> {
    return {
      name: 'get_backtest_run',
      description: 'One saved backtest run: spec, code, stats, report (and optionally its trade list) — to re-run a variant or review it.',
      inputSchema: {
        type: 'object',
        properties: {
          runId: { type: 'string' },
          includeTrades: { type: 'boolean', description: 'Also return up to 200 trades' },
        },
        required: ['runId'],
      },
      execute: async (input) => {
        const r = await this.lab.getRun(String(input?.runId ?? '').trim());
        if (!r) return 'Không tìm thấy run.';
        const trades = Array.isArray(r.trades) ? r.trades : [];
        return j({
          runId: r.id,
          at: r.createdAt.toISOString().slice(0, 16),
          title: r.title,
          status: r.status,
          spec: r.spec,
          stats: r.stats,
          error: r.error,
          report: r.report,
          code: r.code,
          ...(input?.includeTrades ? { trades: trades.slice(0, 200), tradesStored: trades.length } : {}),
        });
      },
    };
  }
}
