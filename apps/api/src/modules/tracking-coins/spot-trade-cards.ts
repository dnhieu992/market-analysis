import { prisma } from '@app/db';

/** Spot trade cards of one conversation, with the portfolio name the card shows. */
export async function listSpotTradeCards(conversationId: string) {
  const rows = await prisma.spotTrade.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } });
  if (!rows.length) return [];
  const pf = await prisma.portfolio.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.portfolioId))] } }, select: { id: true, name: true } });
  const name = new Map(pf.map((p) => [p.id, p.name]));
  return rows.map((r) => ({ ...r, portfolioName: name.get(r.portfolioId) ?? '—' }));
}

/** Ties the cards created during a reply to that reply's message (same as the other chat cards). */
export function attachSpotTrades(conversationId: string, messageId: string, since: Date) {
  return prisma.spotTrade.updateMany({ where: { conversationId, messageId: null, createdAt: { gte: since } }, data: { messageId } });
}
