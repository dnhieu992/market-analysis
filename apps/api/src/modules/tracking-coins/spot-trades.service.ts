import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@app/db';

import { TransactionService } from '../transaction/transaction.service';
import { bareSymbol, coinPositions, listPortfolios } from './spot-portfolio';

export type SpotTradeEdit = { price?: number; amount?: number; portfolioId?: string; transactedAt?: string; note?: string | null };

/**
 * Spot buys / sells proposed by the /tracking-coins chat. A card stays PENDING until the trader
 * confirms it; confirming writes the portfolio transaction (same path as the portfolio page, so
 * holdings and average cost update) and keeps its id. History = the CONFIRMED rows of a coin.
 */
@Injectable()
export class SpotTradesService {
  constructor(private readonly transactions: TransactionService) {}

  private async owned(id: string, userId: string) {
    const t = await prisma.spotTrade.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Lệnh không tồn tại');
    const p = await prisma.portfolio.findFirst({ where: { id: t.portfolioId, userId } });
    if (!p) throw new NotFoundException('Lệnh không tồn tại');
    return t;
  }

  async confirm(id: string, userId: string, edit: SpotTradeEdit = {}) {
    const t = await this.owned(id, userId);
    if (t.status !== 'PENDING') throw new BadRequestException(`Lệnh đã ${t.status === 'CONFIRMED' ? 'được ghi' : 'bị huỷ'}`);
    const price = edit.price ?? t.price;
    const amount = edit.amount ?? t.amount;
    if (!(price > 0) || !(amount > 0)) throw new BadRequestException('Giá và số lượng phải > 0');
    const portfolioId = edit.portfolioId ?? t.portfolioId;
    if (!(await prisma.portfolio.findFirst({ where: { id: portfolioId, userId } }))) throw new BadRequestException('Portfolio không hợp lệ');
    const transactedAt = edit.transactedAt ? new Date(edit.transactedAt) : t.transactedAt;
    if (Number.isNaN(transactedAt.getTime())) throw new BadRequestException('Ngày không hợp lệ');
    const note = edit.note !== undefined ? edit.note : t.note;

    // Claim the row first so a double click can't write two transactions.
    const claimed = await prisma.spotTrade.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'CONFIRMING' } });
    if (claimed.count === 0) throw new BadRequestException('Lệnh đang được xử lý');
    try {
      const tx = await this.transactions.createTransaction(portfolioId, {
        coinId: t.symbol,
        type: t.side === 'sell' ? 'sell' : 'buy',
        price,
        amount,
        transactedAt: transactedAt.toISOString(),
        note: note ? `[Spot Analytic] ${note}` : '[Spot Analytic]',
      });
      return prisma.spotTrade.update({
        where: { id },
        data: { status: 'CONFIRMED', price, amount, portfolioId, transactedAt, note, transactionId: tx.id, confirmedAt: new Date() },
      });
    } catch (e) {
      await prisma.spotTrade.update({ where: { id }, data: { status: 'PENDING' } });
      throw e;
    }
  }

  async cancel(id: string, userId: string) {
    const t = await this.owned(id, userId);
    if (t.status !== 'PENDING') throw new BadRequestException('Chỉ huỷ được lệnh chưa ghi');
    return prisma.spotTrade.update({ where: { id }, data: { status: 'CANCELLED' } });
  }

  /** Trades confirmed from this page (with their portfolio transaction's state) + the coin's real holdings. */
  async history(symbol: string, userId: string) {
    const coin = bareSymbol(symbol);
    const portfolios = await listPortfolios(userId);
    const names = new Map(portfolios.map((p) => [p.id, p.name]));
    const rows = await prisma.spotTrade.findMany({
      where: { symbol: coin, status: 'CONFIRMED', portfolioId: { in: portfolios.map((p) => p.id) } },
      orderBy: { transactedAt: 'desc' },
    });
    const txIds = rows.map((r) => r.transactionId).filter((x): x is string => !!x);
    const txs = txIds.length ? await prisma.coinTransaction.findMany({ where: { id: { in: txIds } }, select: { id: true, deletedAt: true } }) : [];
    const deleted = new Set(txs.filter((x) => x.deletedAt).map((x) => x.id));
    const missing = new Set(txIds.filter((x) => !txs.some((t) => t.id === x)));
    return {
      symbol: coin,
      trades: rows.map((r) => ({
        id: r.id,
        side: r.side,
        price: r.price,
        amount: r.amount,
        value: r.price * r.amount,
        portfolioId: r.portfolioId,
        portfolioName: names.get(r.portfolioId) ?? '—',
        transactedAt: r.transactedAt.toISOString(),
        note: r.note,
        // The portfolio page can delete the transaction afterwards.
        removed: !!r.transactionId && (deleted.has(r.transactionId) || missing.has(r.transactionId)),
      })),
      positions: await coinPositions(userId, coin),
    };
  }

  async listByConversation(conversationId: string) {
    return prisma.spotTrade.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } });
  }
}
