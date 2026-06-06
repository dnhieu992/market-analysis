import Link from 'next/link';

type PriceInfo = Readonly<{
  avgPrice: string;
  currentPrice: string;
  changePct: string;
  positive: boolean;
}>;

type OverviewCard = Readonly<{
  label: string;
  value: string;
  detail: string;
  positive?: boolean;
  href?: string;
  progress?: number; // 0–100
  progressLabel?: string;
  priceInfo?: PriceInfo;
}>;

type OverviewCardsProps = Readonly<{
  cards: readonly OverviewCard[];
}>;

export function OverviewCards({ cards }: OverviewCardsProps) {
  return (
    <section className="metric-grid" aria-label="dashboard metrics">
      {cards.map((card) => {
        const inner = (
          <>
            <p className="metric-label">{card.label}</p>
            <strong
              className="metric-value"
              style={
                card.positive === true
                  ? { color: '#22c55e' }
                  : card.positive === false
                  ? { color: '#ef4444' }
                  : undefined
              }
            >
              {card.value}
            </strong>
            {card.priceInfo && (
              <p className="metric-detail" style={{ marginTop: 4, fontSize: '0.8rem' }}>
                <span style={{ color: 'var(--muted)' }}>Avg </span>
                <span>{card.priceInfo.avgPrice}</span>
                <span style={{ color: 'var(--muted)' }}> · Now </span>
                <span>{card.priceInfo.currentPrice}</span>
                <span style={{ color: 'var(--muted)' }}> · </span>
                <span style={{ color: card.priceInfo.positive ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                  {card.priceInfo.changePct}
                </span>
              </p>
            )}
            <p className="metric-detail">{card.detail}</p>
            {card.progress !== undefined && (
              <div className="metric-progress">
                <div className="metric-progress-bar">
                  <div
                    className="metric-progress-fill"
                    style={{ width: `${Math.min(card.progress, 100)}%` }}
                  />
                </div>
                {card.progressLabel && (
                  <span className="metric-progress-label">{card.progressLabel}</span>
                )}
              </div>
            )}
          </>
        );
        return card.href ? (
          <Link key={card.label} href={card.href} className="metric-card metric-card--link">
            {inner}
          </Link>
        ) : (
          <article key={card.label} className="metric-card">
            {inner}
          </article>
        );
      })}
    </section>
  );
}
