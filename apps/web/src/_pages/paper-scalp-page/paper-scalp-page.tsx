import { createServerApiClient } from '@web/shared/auth/api-auth';
import { PaperScalpBoard } from '@web/widgets/paper-scalp-board/paper-scalp-board';
import type { ScalpPaperTradeBoard as BoardData } from '@web/shared/api/types';

const EMPTY_BOARD: BoardData = {
  symbol: 'BTCUSDT',
  price: null,
  openTrade: null,
  history: [],
  stats: { closedCount: 0, wins: 0, losses: 0, closedEarly: 0, winRate: null, totalPnlUsd: 0, totalR: 0 },
};

export default async function PaperScalpPage() {
  const client = createServerApiClient();
  const board = await client.fetchScalpPaperTradeBoard().catch(() => EMPTY_BOARD);

  return <PaperScalpBoard initialBoard={board} />;
}
