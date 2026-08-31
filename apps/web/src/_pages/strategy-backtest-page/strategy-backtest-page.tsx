import { createServerApiClient } from '@web/shared/auth/api-auth';
import { StrategyBacktestBoard } from '@web/widgets/strategy-backtest/strategy-backtest-board';
import type { StrategyBacktestBoard as BoardData } from '@web/shared/api/types';

const EMPTY_BOARD: BoardData = { price: null, symbol: 'BTCUSDT', setups: [] };

export default async function StrategyBacktestPage() {
  const client = createServerApiClient();
  const board = await client.fetchStrategyBacktestBoard().catch(() => EMPTY_BOARD);

  return <StrategyBacktestBoard initialBoard={board} />;
}
