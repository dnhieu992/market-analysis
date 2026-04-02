type OverviewCard = Readonly<{
  label: string;
  value: string;
  detail: string;
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
          <strong className="metric-value">{card.value}</strong>
          <p className="metric-detail">{card.detail}</p>
        </article>
      ))}
    </section>
  );
}
