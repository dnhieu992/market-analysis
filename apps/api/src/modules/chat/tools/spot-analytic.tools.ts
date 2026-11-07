import { prisma } from '@app/db';

import type { ChatTool } from '../contracts/chat-tool';
import { bareSymbol, coinPositions, conversationUserId, listPortfolios, resolvePortfolio } from '../../tracking-coins/spot-portfolio';

const fmt = (n: number) => (Number.isFinite(n) ? Number(n.toPrecision(8)) : n);

async function lastPrice(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${bareSymbol(symbol)}USDT`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return Number(((await res.json()) as { price: string }).price);
  } catch {
    return null;
  }
}

/** Text block: the coin's position in each portfolio (amount, avg cost, unrealized PnL) — shared by the tool and the prompt context. */
export async function describePosition(userId: string | null, symbol: string): Promise<string> {
  const coin = bareSymbol(symbol);
  const [pos, price] = await Promise.all([coinPositions(userId, coin), lastPrice(coin)]);
  if (!pos.length) return `${coin}: chưa có trong portfolio nào.`;
  const lines = pos.map((p) => {
    const upnl = price && p.amount > 0 ? ((price - p.avgCost) / p.avgCost) * 100 : null;
    return (
      `- ${p.portfolioName}: đang giữ ${fmt(p.amount)} ${coin}` +
      (p.amount > 0 ? `, giá TB ${fmt(p.avgCost)}, vốn ${fmt(p.totalCost)} USDT${upnl != null ? `, lãi/lỗ tạm tính ${upnl >= 0 ? '+' : ''}${upnl.toFixed(1)}%` : ''}` : ' (đã bán hết)') +
      `, đã chốt ${fmt(p.realizedPnl)} USDT, ${p.txCount} giao dịch (gần nhất ${p.lastTxAt?.slice(0, 10) ?? '—'})`
    );
  });
  return `${coin} trong portfolio (giá hiện tại ${price ?? '—'}):\n${lines.join('\n')}`;
}

export const getPortfolioPositionTool: ChatTool<{ symbol?: string; transactions?: number }, string> = {
  name: 'get_portfolio_position',
  description:
    "Read the user's spot portfolios for one coin: in which portfolio it is held, amount, average cost, invested, realized PnL, unrealized % at the live price, and its latest transactions (all of them, including ones typed on the portfolio page). Also lists the portfolio names. Use before planning buys/sells or proposing a trade.",
  inputSchema: {
    type: 'object',
    properties: {
      symbol: { type: 'string', description: 'Coin, e.g. "ADA"' },
      transactions: { type: 'number', description: 'How many latest transactions to list (default 10, max 50)' },
    },
    required: ['symbol'],
  },
  async execute(input, context) {
    const userId = await conversationUserId(context?.conversationId);
    const coin = bareSymbol(String(input?.symbol ?? ''));
    if (!coin) return 'Thiếu symbol.';
    const take = Math.min(Math.max(Number(input?.transactions) || 10, 1), 50);
    const portfolios = await listPortfolios(userId);
    const txs = await prisma.coinTransaction.findMany({
      where: { coinId: coin, deletedAt: null, portfolioId: { in: portfolios.map((p) => p.id) } },
      orderBy: { transactedAt: 'desc' },
      take,
    });
    const name = new Map(portfolios.map((p) => [p.id, p.name]));
    return [
      await describePosition(userId, coin),
      `Portfolio hiện có: ${portfolios.map((p) => p.name).join(', ')}`,
      txs.length
        ? `${txs.length} giao dịch gần nhất của ${coin}:\n` +
          txs.map((t) => `- ${t.transactedAt.toISOString().slice(0, 16).replace('T', ' ')} ${t.type === 'sell' ? 'BÁN' : 'MUA'} ${fmt(Number(t.amount))} @ ${fmt(Number(t.price))} (${fmt(Number(t.totalValue))} USDT) · ${name.get(t.portfolioId)}${t.note ? ` · ${t.note.slice(0, 80)}` : ''}`).join('\n')
        : `Chưa có giao dịch ${coin}.`,
    ].join('\n\n');
  },
};

type ProposeInput = { symbol: string; side: string; price: number; amount?: number; total?: number; transactedAt?: string; portfolio?: string; note?: string };

export const proposeSpotTradeTool: ChatTool<ProposeInput, string> = {
  name: 'propose_spot_trade',
  description:
    'Record a spot BUY or SELL the user says they made (or asks to log) into their portfolio. It creates a card under your reply; NOTHING is written until the user presses "Xác nhận" (they can edit the numbers first). ' +
    'Portfolio: leave empty and the coin\'s only portfolio is used; if the coin is in several portfolios or in none, the tool tells you to ask the user — then call again with `portfolio` (name). ' +
    'Give amount (coin quantity) or total (USDT spent/received; amount = total / price). transactedAt defaults to now (ISO time, Vietnam time is GMT+7). One call per trade.',
  inputSchema: {
    type: 'object',
    properties: {
      symbol: { type: 'string', description: 'Coin, e.g. "ADA"' },
      side: { type: 'string', description: '"buy" or "sell"' },
      price: { type: 'number', description: 'Fill price in USDT' },
      amount: { type: 'number', description: 'Coin quantity' },
      total: { type: 'number', description: 'USDT value instead of amount' },
      transactedAt: { type: 'string', description: 'When, ISO 8601 (e.g. 2026-11-07T09:30:00+07:00). Default now.' },
      portfolio: { type: 'string', description: 'Portfolio name, only when needed (see description)' },
      note: { type: 'string', description: 'Short note, e.g. "phần 1/3 vùng 0.40"' },
    },
    required: ['symbol', 'side', 'price'],
  },
  async execute(input, context) {
    const userId = await conversationUserId(context?.conversationId);
    const coin = bareSymbol(String(input?.symbol ?? ''));
    const side = String(input?.side ?? '').toLowerCase().startsWith('s') ? 'sell' : 'buy';
    const price = Number(input?.price);
    let amount = Number(input?.amount);
    if (!(amount > 0) && Number(input?.total) > 0 && price > 0) amount = Number(input.total) / price;
    if (!coin || !(price > 0) || !(amount > 0)) return 'Chưa tạo thẻ: cần symbol, giá > 0 và số lượng (amount) hoặc tổng USDT (total) > 0.';
    const at = input?.transactedAt ? new Date(input.transactedAt) : new Date();
    if (Number.isNaN(at.getTime())) return 'Chưa tạo thẻ: transactedAt không hợp lệ.';

    const pf = await resolvePortfolio(userId, coin, input?.portfolio ?? null);
    if (!pf.ok) return `Chưa tạo thẻ. ${pf.ask}`;
    if (side === 'sell') {
      const h = await prisma.holding.findUnique({ where: { portfolioId_coinId: { portfolioId: pf.id, coinId: coin } } });
      const have = h ? Number(h.totalAmount) : 0;
      if (amount > have + 1e-12) return `Chưa tạo thẻ: ${pf.name} chỉ đang giữ ${fmt(have)} ${coin}, không bán được ${fmt(amount)}.`;
    }
    const t = await prisma.spotTrade.create({
      data: {
        symbol: coin,
        side,
        price,
        amount,
        portfolioId: pf.id,
        transactedAt: at,
        note: input?.note ? String(input.note).slice(0, 500) : null,
        conversationId: context?.conversationId ?? null,
      },
    });
    return `Đã tạo thẻ ${side === 'sell' ? 'BÁN' : 'MUA'} ${fmt(amount)} ${coin} @ ${fmt(price)} (${fmt(amount * price)} USDT) vào ${pf.name}, ngày ${at.toISOString().slice(0, 16)}Z (id ${t.id}). Chờ người dùng bấm Xác nhận — chưa ghi vào portfolio.`;
  },
};
