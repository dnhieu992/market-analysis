import { createServerApiClient } from '@web/shared/auth/api-auth';
import type { DashboardOrder } from '@web/shared/api/types';
import { DashboardOverview } from '@web/widgets/dashboard-overview/dashboard-overview';

async function fetchCurrentPrices(coins: string[]): Promise<Record<string, number>> {
  try {
    const symbols = JSON.stringify(coins.map((c) => `${c}USDT`));
    const res = await fetch(
      `https://api.binance.com/api/v3/ticker/price?symbols=${encodeURIComponent(symbols)}`,
      { next: { revalidate: 60 } }
    );
    if (!res.ok) return {};
    const data = (await res.json()) as { symbol: string; price: string }[];
    const result: Record<string, number> = {};
    for (const item of data) {
      const coin = item.symbol.replace('USDT', '');
      result[coin] = parseFloat(item.price);
    }
    return result;
  } catch {
    return {};
  }
}

async function loadDashboardData() {
  const client = createServerApiClient();
  try {
    const [paginatedOrders, analysisRuns, portfolios] = await Promise.all([
      client.fetchOrders({ pageSize: 20 }),
      client.fetchAnalysisRuns(),
      client.fetchPortfolios(),
    ]);

    // fetch holdings for all portfolios in parallel
    const holdingsByPortfolio = await Promise.all(
      portfolios.map((p) => client.fetchHoldings(p.id).catch(() => []))
    );

    // aggregate by coinId across all portfolios; keep first portfolioId per coin for navigation
    const map = new Map<string, { totalAmount: number; totalCost: number; realizedPnl: number; portfolioId: string }>();
    portfolios.forEach((portfolio, i) => {
      const holdings = holdingsByPortfolio[i] ?? [];
      for (const h of holdings) {
        const existing = map.get(h.coinId);
        if (existing) {
          existing.totalAmount += h.totalAmount;
          existing.totalCost += h.totalInvested;
          existing.realizedPnl += h.realizedPnl;
        } else {
          map.set(h.coinId, { totalAmount: h.totalAmount, totalCost: h.totalInvested, realizedPnl: h.realizedPnl, portfolioId: portfolio.id });
        }
      }
    });

    const allHoldings = Array.from(map.entries()).map(([coinId, v]) => ({
      coinId,
      totalAmount: v.totalAmount,
      totalCost: v.totalCost,
      // derived avg cost from aggregated totals
      avgCost: v.totalAmount > 0 ? v.totalCost / v.totalAmount : 0,
      realizedPnl: v.realizedPnl,
      portfolioId: v.portfolioId,
    }));

    const trackedCoins = allHoldings
      .filter((h) => ['BTC', 'ETH'].includes(h.coinId.toUpperCase()))
      .map((h) => h.coinId.toUpperCase());
    const currentPrices = trackedCoins.length > 0 ? await fetchCurrentPrices(trackedCoins) : {};

    return {
      recentOrders: paginatedOrders.data,
      openOrderCount: paginatedOrders.openOrders.length,
      closedOrderCount: paginatedOrders.total - paginatedOrders.openOrders.length,
      closedPnlSum: paginatedOrders.closedPnlSum,
      analysisRuns,
      allHoldings,
      currentPrices,
      portfolioCount: portfolios.length,
    };
  } catch {
    return {
      recentOrders: [] as DashboardOrder[],
      openOrderCount: 0,
      closedOrderCount: 0,
      closedPnlSum: 0,
      analysisRuns: [],
      allHoldings: [],
      currentPrices: {} as Record<string, number>,
      portfolioCount: 0,
    };
  }
}

const BTC_TARGET = 1;
const ETH_TARGET = 10;

type CoinStats = { amount: number; cost: number; avgCost: number; currentPrice: number | null };

function buildPriceInfo(stats: CoinStats, usdFormatter: Intl.NumberFormat) {
  if (stats.amount <= 0 || stats.avgCost <= 0 || stats.currentPrice == null) return undefined;
  const changePct = ((stats.currentPrice - stats.avgCost) / stats.avgCost) * 100;
  const positive = changePct >= 0;
  return {
    avgPrice: usdFormatter.format(stats.avgCost),
    currentPrice: usdFormatter.format(stats.currentPrice),
    changePct: (positive ? '+' : '') + changePct.toFixed(2) + '%',
    positive,
  };
}

function buildOverviewCards(
  openOrderCount: number,
  closedOrderCount: number,
  closedPnlSum: number,
  btc: CoinStats,
  eth: CoinStats,
  btcHref?: string,
  ethHref?: string,
) {
  const totalPnlStr =
    (closedPnlSum >= 0 ? '+' : '') +
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(closedPnlSum);

  const usdFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

  const btcStr = btc.amount > 0
    ? new Intl.NumberFormat('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 8 }).format(btc.amount) + ' BTC'
    : '--';
  const btcProgress = Math.min((btc.amount / BTC_TARGET) * 100, 100);
  const btcPct = btcProgress.toFixed(2);
  const btcRemaining = Math.max(BTC_TARGET - btc.amount, 0);
  const btcRemainingStr = new Intl.NumberFormat('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 8 }).format(btcRemaining);
  const btcCostStr = btc.cost > 0 ? usdFormatter.format(btc.cost) : null;

  const ethStr = eth.amount > 0
    ? new Intl.NumberFormat('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 8 }).format(eth.amount) + ' ETH'
    : '--';
  const ethProgress = Math.min((eth.amount / ETH_TARGET) * 100, 100);
  const ethPct = ethProgress.toFixed(2);
  const ethRemaining = Math.max(ETH_TARGET - eth.amount, 0);
  const ethRemainingStr = new Intl.NumberFormat('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 8 }).format(ethRemaining);
  const ethCostStr = eth.cost > 0 ? usdFormatter.format(eth.cost) : null;

  const totalOrders = openOrderCount + closedOrderCount;

  return [
    {
      label: 'BTC Accumulated',
      value: btcStr,
      detail: btcCostStr ? `${btcPct}% toward ${BTC_TARGET} BTC · ${btcCostStr} invested` : `${btcPct}% toward ${BTC_TARGET} BTC goal`,
      progress: btcProgress,
      progressLabel: btcRemaining > 0 ? `${btcRemainingStr} BTC remaining` : 'Goal reached!',
      priceInfo: buildPriceInfo(btc, usdFormatter),
      href: btcHref,
    },
    {
      label: 'ETH Accumulated',
      value: ethStr,
      detail: ethCostStr ? `${ethPct}% toward ${ETH_TARGET} ETH · ${ethCostStr} invested` : `${ethPct}% toward ${ETH_TARGET} ETH goal`,
      progress: ethProgress,
      progressLabel: ethRemaining > 0 ? `${ethRemainingStr} ETH remaining` : 'Goal reached!',
      priceInfo: buildPriceInfo(eth, usdFormatter),
      href: ethHref,
    },
    {
      label: 'Orders',
      value: String(totalOrders),
      detail: `${openOrderCount} open · ${closedOrderCount} closed`,
    },
    {
      label: 'Total Profit / Loss',
      value: closedOrderCount === 0 ? '--' : totalPnlStr,
      detail: 'All-time realized P/L across closed trades.',
      positive: closedOrderCount === 0 ? undefined : closedPnlSum >= 0,
      href: '/pnl-calendar'
    }
  ];
}

export default async function OverviewPage() {
  const { recentOrders, openOrderCount, closedOrderCount, closedPnlSum, allHoldings, currentPrices, portfolioCount } =
    await loadDashboardData();

  const btcHolding = allHoldings.find((h) => h.coinId.toUpperCase() === 'BTC');
  const ethHolding = allHoldings.find((h) => h.coinId.toUpperCase() === 'ETH');

  const btcHref = btcHolding ? `/portfolio/${btcHolding.portfolioId}/${btcHolding.coinId}` : undefined;
  const ethHref = ethHolding ? `/portfolio/${ethHolding.portfolioId}/${ethHolding.coinId}` : undefined;

  const btc: CoinStats = {
    amount: btcHolding?.totalAmount ?? 0,
    cost: btcHolding?.totalCost ?? 0,
    avgCost: btcHolding?.avgCost ?? 0,
    currentPrice: currentPrices['BTC'] ?? null,
  };
  const eth: CoinStats = {
    amount: ethHolding?.totalAmount ?? 0,
    cost: ethHolding?.totalCost ?? 0,
    avgCost: ethHolding?.avgCost ?? 0,
    currentPrice: currentPrices['ETH'] ?? null,
  };

  const cards = buildOverviewCards(openOrderCount, closedOrderCount, closedPnlSum, btc, eth, btcHref, ethHref);

  return (
    <DashboardOverview
      cards={cards}
      allHoldings={allHoldings}
      portfolioCount={portfolioCount}
      orders={recentOrders}
    />
  );
}
