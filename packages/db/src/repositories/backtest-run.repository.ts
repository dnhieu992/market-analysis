import type { Prisma } from '@prisma/client';

import { prisma } from '../client';

export type BacktestRunInput = {
  conversationId?: string | null;
  skillId?: string | null;
  title: string;
  status: 'OK' | 'ERROR';
  spec: Prisma.InputJsonValue;
  code: string;
  stats?: Prisma.InputJsonValue | null;
  trades?: Prisma.InputJsonValue | null;
  logs?: Prisma.InputJsonValue | null;
  error?: string | null;
  durationMs?: number | null;
};

/** Backtests run from an AI chat in the sandbox, plus the chat's write-up (`report`). */
export function createBacktestRunRepository(client = prisma) {
  return {
    create(input: BacktestRunInput) {
      return client.backtestRun.create({
        data: {
          conversationId: input.conversationId ?? null,
          skillId: input.skillId ?? null,
          title: input.title.slice(0, 200),
          status: input.status,
          spec: input.spec,
          code: input.code,
          stats: input.stats ?? undefined,
          trades: input.trades ?? undefined,
          logs: input.logs ?? undefined,
          error: input.error ?? null,
          durationMs: input.durationMs ?? null,
        },
      });
    },

    findById(id: string) {
      return client.backtestRun.findUnique({ where: { id } });
    },

    saveReport(id: string, report: string) {
      return client.backtestRun.update({ where: { id }, data: { report, reportAt: new Date() } });
    },

    /** Newest first, without the heavy columns (code / trades / logs). */
    listRecent(opts: { take?: number; query?: string } = {}) {
      return client.backtestRun.findMany({
        where: opts.query ? { title: { contains: opts.query } } : undefined,
        orderBy: { createdAt: 'desc' },
        take: Math.min(Math.max(opts.take ?? 15, 1), 50),
        select: {
          id: true,
          conversationId: true,
          title: true,
          status: true,
          spec: true,
          stats: true,
          error: true,
          reportAt: true,
          createdAt: true,
        },
      });
    },
  };
}
