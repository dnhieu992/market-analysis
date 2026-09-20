import { createServerApiClient } from '@web/shared/auth/api-auth';
import { StrategyBoard } from '@web/widgets/strategy-board/strategy-board';
import type { StrategyPaperBoard } from '@web/shared/api/types';

const EMPTY_BOARD: StrategyPaperBoard = {
  symbol: 'BTCUSDT',
  price: null,
  config: {
    name: 'BTC — Phá đỉnh/đáy ngày hôm trước',
    enabled: true,
    symbol: 'BTCUSDT',
    timeframe: '1h',
    riskUsd: 10,
    rrPlanned: 2,
    docMarkdown: '',
  },
  openTrades: [],
  history: [],
  stats: { closedCount: 0, wins: 0, losses: 0, eod: 0, winRate: null, totalPnlUsd: 0, totalR: 0 },
  levels: null,
};

export default async function TradingAnalysisPage() {
  const client = createServerApiClient();
  const board = await client.fetchStrategyPaperBoard().catch(() => EMPTY_BOARD);
  return <StrategyBoard initialBoard={board} />;
}
