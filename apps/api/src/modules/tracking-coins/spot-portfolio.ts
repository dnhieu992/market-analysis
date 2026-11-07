import { prisma } from '@app/db';

/**
 * Shared helpers of the /tracking-coins page (Spot Analytic): the coin's position in the
 * trader's portfolios, which portfolio a chat-proposed trade goes to, and Binance market cap /
 * sector tags. Used by both the HTTP controller and the chat tools.
 */

export const bareSymbol = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/USDT$/, '');

export type PortfolioPosition = {
  portfolioId: string;
  portfolioName: string;
  amount: number;
  avgCost: number;
  totalCost: number;
  realizedPnl: number;
  txCount: number;
  lastTxAt: string | null;
};

/** Every portfolio of the user that holds the coin now or ever had a (non-deleted) transaction of it. */
export async function coinPositions(userId: string | null, symbol: string): Promise<PortfolioPosition[]> {
  const coin = bareSymbol(symbol);
  const portfolios = await prisma.portfolio.findMany({ where: userId ? { userId } : {}, select: { id: true, name: true }, orderBy: { createdAt: 'asc' } });
  if (!portfolios.length) return [];
  const ids = portfolios.map((p) => p.id);
  const [holdings, txs] = await Promise.all([
    prisma.holding.findMany({ where: { portfolioId: { in: ids }, coinId: coin } }),
    prisma.coinTransaction.groupBy({ by: ['portfolioId'], where: { portfolioId: { in: ids }, coinId: coin, deletedAt: null }, _count: { _all: true }, _max: { transactedAt: true } }),
  ]);
  const out: PortfolioPosition[] = [];
  for (const p of portfolios) {
    const h = holdings.find((x) => x.portfolioId === p.id);
    const t = txs.find((x) => x.portfolioId === p.id);
    if (!h && !t) continue;
    out.push({
      portfolioId: p.id,
      portfolioName: p.name,
      amount: h ? Number(h.totalAmount) : 0,
      avgCost: h ? Number(h.avgCost) : 0,
      totalCost: h ? Number(h.totalCost) : 0,
      realizedPnl: h ? Number(h.realizedPnl) : 0,
      txCount: t?._count._all ?? 0,
      lastTxAt: t?._max.transactedAt?.toISOString() ?? null,
    });
  }
  return out;
}

export async function listPortfolios(userId: string | null) {
  return prisma.portfolio.findMany({ where: userId ? { userId } : {}, select: { id: true, name: true }, orderBy: { createdAt: 'asc' } });
}

/**
 * Portfolio for a chat-proposed trade. An explicit choice (id or name) wins; otherwise the coin's
 * only portfolio. None or several → `ask` with the options, so the chat asks the trader.
 */
export async function resolvePortfolio(
  userId: string | null,
  symbol: string,
  hint?: string | null,
): Promise<{ ok: true; id: string; name: string } | { ok: false; ask: string }> {
  const all = await listPortfolios(userId);
  if (hint && hint.trim()) {
    const h = hint.trim().toLowerCase();
    const hit = all.find((p) => p.id === hint.trim()) ?? all.find((p) => p.name.toLowerCase() === h) ?? all.filter((p) => p.name.toLowerCase().includes(h));
    const one = Array.isArray(hit) ? (hit.length === 1 ? hit[0] : null) : hit;
    if (one) return { ok: true, id: one.id, name: one.name };
    return { ok: false, ask: `Không khớp portfolio "${hint}". Các portfolio: ${all.map((p) => p.name).join(', ')}.` };
  }
  const pos = await coinPositions(userId, symbol);
  if (pos.length === 1) return { ok: true, id: pos[0]!.portfolioId, name: pos[0]!.portfolioName };
  if (pos.length > 1) {
    return { ok: false, ask: `${bareSymbol(symbol)} đang có ở ${pos.length} portfolio: ${pos.map((p) => `${p.portfolioName} (giữ ${p.amount})`).join(', ')}. Hỏi người dùng ghi vào portfolio nào rồi gọi lại với portfolio.` };
  }
  return { ok: false, ask: `${bareSymbol(symbol)} chưa có trong portfolio nào. Hỏi người dùng ghi vào portfolio nào (${all.map((p) => p.name).join(', ')}) rồi gọi lại với portfolio.` };
}

/** Owner of a chat conversation — chat tools only see that user's portfolios. */
export async function conversationUserId(conversationId?: string | null): Promise<string | null> {
  if (!conversationId) return null;
  const c = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { userId: true } });
  return c?.userId ?? null;
}

// ── Binance market cap + sector tags ─────────────────────────────────────────

type Product = { b: string; q: string; c: string; cs: number | null; tags?: string[] | null };
let productCache: { at: number; map: Map<string, Product> } | null = null;
const PRODUCT_TTL_MS = 60 * 60 * 1000;

async function products(): Promise<Map<string, Product>> {
  if (productCache && Date.now() - productCache.at < PRODUCT_TTL_MS) return productCache.map;
  try {
    const res = await fetch('https://www.binance.com/bapi/asset/v2/public/asset-service/product/get-products?includeEtf=true', { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Binance products ${res.status}`);
    const rows = ((await res.json()) as { data: Product[] }).data ?? [];
    const map = new Map<string, Product>();
    for (const r of rows) if (r.q === 'USDT') map.set(r.b, r);
    productCache = { at: Date.now(), map };
    return map;
  } catch (e) {
    if (productCache) return productCache.map; // stale beats empty
    throw e;
  }
}

// Binance lumps L1 and L2 into one tag; these are the common rollups / L2s.
const L2 = new Set(['ARB', 'OP', 'POL', 'MATIC', 'STRK', 'MNT', 'IMX', 'ZK', 'METIS', 'MANTA', 'BLAST', 'SCR', 'TAIKO', 'ZRO', 'LRC', 'SKL', 'CELO', 'BOBA', 'CTSI', 'LINEA', 'ZKC']);
// Own-chain coins Binance only tags as "Payments".
const L1_UNTAGGED = new Set(['BTC', 'LTC', 'BCH', 'XRP', 'XLM', 'ZEC', 'DASH', 'XMR']);
const TAG_LABEL: Record<string, string> = {
  Meme: 'Meme',
  defi: 'DeFi',
  AI: 'AI',
  RWA: 'RWA',
  Gaming: 'Gaming',
  NFT: 'NFT',
  Infrastructure: 'Infra',
  Payments: 'Payments',
  Solana: 'Solana eco',
  BSC: 'BNB eco',
  fan_token: 'Fan token',
  'storage-zone': 'Storage',
  stablecoin: 'Stablecoin',
  Monitoring: '⚠ Monitoring',
  Seed: 'Seed',
};

/** Binance tags → short sector labels (L1 / L2 split by a known-rollup list). */
export function sectorLabels(symbol: string, tags: string[]): string[] {
  const out: string[] = [];
  if (tags.includes('Layer1_Layer2')) out.push(L2.has(symbol) ? 'L2' : 'L1');
  else if (L1_UNTAGGED.has(symbol)) out.push('L1');
  for (const t of tags) if (TAG_LABEL[t] && !out.includes(TAG_LABEL[t]!)) out.push(TAG_LABEL[t]!);
  return out;
}

export type CoinMeta = { symbol: string; marketCap: number | null; sectors: string[] };

/** Market cap (Binance circulating supply × last price) and sector labels per bare symbol. */
export async function coinMeta(symbols: string[]): Promise<CoinMeta[]> {
  const map = await products();
  return [...new Set(symbols.map(bareSymbol).filter(Boolean))].map((s) => {
    const p = map.get(s);
    const price = p ? Number(p.c) : NaN;
    const cap = p && p.cs && Number.isFinite(price) ? p.cs * price : null;
    return { symbol: s, marketCap: cap, sectors: p ? sectorLabels(s, p.tags ?? []) : [] };
  });
}
