import { Prisma } from '@prisma/client';

import { prisma } from '../client';

export type ChartSampleInput = Partial<{
  imageUrl: string | null;
  images: Prisma.InputJsonValue | null;
  entryPriceTo: number | null;
  entryZone: string | null;
  result: string | null;
  closedAt: Date | null;
  imageKey: string | null;
  symbol: string | null;
  interval: string | null;
  chartTime: Date | null;
  entryPrice: number | null;
  tpPrice: number | null;
  slPrice: number | null;
  aiSummary: string | null;
  analyzedAt: Date | null;
  direction: string | null;
  tpPct: number | null;
  slPct: number | null;
  note: string | null;
  tags: string[];
  aiRead: Prisma.InputJsonValue | null;
  features: Prisma.InputJsonValue | null;
  outcome: Prisma.InputJsonValue | null;
  outcomeStatus: 'PENDING' | 'DONE' | 'ERROR';
  outcomeError: string | null;
  conversationId: string | null;
}>;

const jsonOrNull = (v: Prisma.InputJsonValue | null) => (v === null ? Prisma.DbNull : v);

function toData(input: ChartSampleInput): Prisma.ChartSampleUpdateInput {
  const { tags, aiRead, features, outcome, images, ...rest } = input;
  const data: Prisma.ChartSampleUpdateInput = { ...rest };
  if (tags !== undefined) data.tags = tags;
  if (images !== undefined) data.images = jsonOrNull(images);
  if (aiRead !== undefined) data.aiRead = jsonOrNull(aiRead);
  if (features !== undefined) data.features = jsonOrNull(features);
  if (outcome !== undefined) data.outcome = jsonOrNull(outcome);
  return data;
}

/** Chart Lab samples (apps/api chart-lab module). */
export function createChartSampleRepository(client = prisma) {
  return {
    create(input: ChartSampleInput) {
      return client.chartSample.create({ data: toData(input) as Prisma.ChartSampleCreateInput });
    },
    update(id: string, input: ChartSampleInput) {
      return client.chartSample.update({ where: { id }, data: toData(input) });
    },
    findById(id: string) {
      return client.chartSample.findUnique({ where: { id } });
    },
    findMany(ids: string[]) {
      return client.chartSample.findMany({ where: { id: { in: ids } } });
    },
    list(take = 500) {
      return client.chartSample.findMany({ orderBy: { createdAt: 'desc' }, take });
    },
    listPending(take = 50) {
      return client.chartSample.findMany({ where: { outcomeStatus: 'PENDING', chartTime: { not: null } }, orderBy: { updatedAt: 'asc' }, take });
    },
    remove(id: string) {
      return client.chartSample.delete({ where: { id } });
    },
  };
}
