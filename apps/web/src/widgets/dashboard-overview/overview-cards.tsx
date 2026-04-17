type OverviewCard = Readonly<{
  label: string;
  value: string;
  detail: string;
  positive?: boolean;
}>;

type OverviewCardsProps = Readonly<{
  cards: readonly OverviewCard[];
}>;

export function OverviewCards({ cards }: OverviewCardsProps) {
  return (
    <section className="metric-grid" aria-label="dashboard metrics">
      {cards.map((card) => (
        <article key={card.label} className="metric-card">
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
          <p className="metric-detail">{card.detail}</p>
        </article>
      ))}
    </section>
  );
}
