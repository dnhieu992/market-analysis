import Link from 'next/link';

import { formatDateTime, formatPrice } from '../../lib/format';
import type { DashboardOrder } from '../../lib/types';

type RecentOrdersPanelProps = Readonly<{
  orders: DashboardOrder[];
}>;

export function RecentOrdersPanel({ orders }: RecentOrdersPanelProps) {
  return (
    <article className="panel">
      <h2>Order Activity</h2>
      <p>Manual trades and closed orders from the database.</p>

      <div className="orders-list">
        {orders.slice(0, 4).map((order) => (
          <div key={order.id} className="order-row">
            <div>
              <strong className="order-symbol">{order.symbol}</strong>
              <p className="order-subline">
                {order.side} · {order.status}
              </p>
            </div>
            <div className="order-values">
              <span>{formatPrice(order.entryPrice)}</span>
              <span>{formatDateTime(order.openedAt)}</span>
            </div>
          </div>
        ))}
      </div>

      <Link href="/trades" className="analysis-link">
        Open trading history
      </Link>
    </article>
  );
}
