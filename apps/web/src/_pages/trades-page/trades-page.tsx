import { Suspense } from 'react';

import { createServerApiClient } from '@web/shared/auth/api-auth';
import type { PaginatedOrders } from '@web/shared/api/types';
import { TradesHistory } from '@web/widgets/trades-history/trades-history';

const PAGE_SIZE = 20;

function getString(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

type Props = {
  searchParams: Record<string, string | string[] | undefined>;
};

export default async function TradesPage({ searchParams }: Props) {
  const client = createServerApiClient();

  const page = Number(getString(searchParams.page) ?? '1') || 1;
  const params = {
    symbol: getString(searchParams.symbol),
    status: getString(searchParams.status),
    broker: getString(searchParams.broker),
    dateFrom: getString(searchParams.dateFrom),
    dateTo: getString(searchParams.dateTo),
    page,
    pageSize: PAGE_SIZE,
  };

  const empty: PaginatedOrders = {
    data: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    closedPnlSum: 0,
    openOrders: [],
  };

  let result = empty;
  let brokers: string[] = [];

  try {
    [result, brokers] = await Promise.all([
      client.fetchOrders(params),
      client.fetchOrderBrokers(),
    ]);
  } catch {
    // fallback to empty — page still renders
  }

  return (
    <Suspense>
      <TradesHistory
        orders={result.data}
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        closedPnlSum={result.closedPnlSum}
        openOrders={result.openOrders}
        availableBrokers={brokers}
      />
    </Suspense>
  );
}
