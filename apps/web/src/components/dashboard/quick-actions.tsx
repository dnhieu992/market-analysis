import Link from 'next/link';

type QuickActionsProps = Readonly<{
  lastUpdatedLabel: string;
}>;

export function QuickActions({ lastUpdatedLabel }: QuickActionsProps) {
  return (
    <section className="panel quick-actions-panel" aria-label="quick actions">
      <div className="quick-actions-copy">
        <h2>Quick Actions</h2>
        <p>Move directly into manual trading or deeper analysis review.</p>
      </div>
      <div className="quick-actions-links">
        <Link href="/trades" className="quick-action-button">
          Add Manual Trade
        </Link>
        <Link href="/analysis" className="quick-action-button quick-action-button-secondary">
          Open Analysis Feed
        </Link>
      </div>
      <p className="quick-actions-updated">Last updated {lastUpdatedLabel}</p>
    </section>
  );
}
