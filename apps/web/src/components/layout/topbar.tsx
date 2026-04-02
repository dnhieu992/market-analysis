type TopbarProps = Readonly<{
  currentPath: string;
}>;

const ROUTE_LABELS: Record<string, string> = {
  '/': 'Overview',
  '/trades': 'Trading History',
  '/analysis': 'Analysis Feed'
};

export function Topbar({ currentPath }: TopbarProps) {
  return (
    <header className="topbar">
      <div>
        <p className="topbar-kicker">Market Analysis Bot</p>
        <h1>{ROUTE_LABELS[currentPath] ?? 'Dashboard'}</h1>
      </div>

      <div className="topbar-status">
        <span className="status-dot" />
        <span>Local dashboard ready</span>
      </div>
    </header>
  );
}
