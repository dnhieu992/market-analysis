const overviewMetrics = [
  { label: 'Open Trades', value: '0', detail: 'No active manual positions yet.' },
  { label: 'Recent Signals', value: '0', detail: 'Worker output will appear here.' },
  { label: 'Avg. Confidence', value: '--', detail: 'Awaiting the first analysis cycle.' }
] as const;

export default function HomePage() {
  return (
    <main className="dashboard-shell">
      <section className="hero-card">
        <div className="hero-copy">
          <p className="eyebrow">Market Analysis Bot</p>
          <h1>Overview Dashboard</h1>
          <p className="lead">
            Track manual trades, review worker-generated analysis, and keep the full trading
            history in one place.
          </p>
        </div>
        <div className="hero-status">
          <span className="status-dot" />
          <span>Local dashboard scaffold ready</span>
        </div>
      </section>

      <section className="metric-grid" aria-label="dashboard metrics">
        {overviewMetrics.map((metric) => (
          <article key={metric.label} className="metric-card">
            <p className="metric-label">{metric.label}</p>
            <strong className="metric-value">{metric.value}</strong>
            <p className="metric-detail">{metric.detail}</p>
          </article>
        ))}
      </section>

      <section className="content-grid">
        <article className="panel">
          <h2>Recent Analysis</h2>
          <p>Structured analysis from the worker will be listed here.</p>
        </article>
        <article className="panel">
          <h2>Trading History</h2>
          <p>Manual entries and closed trades will show up here.</p>
        </article>
      </section>
    </main>
  );
}
