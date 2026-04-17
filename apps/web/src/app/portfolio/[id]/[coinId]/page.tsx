import PortfolioCoinPage from '@web/pages/portfolio-coin-page/portfolio-coin-page';

type PageProps = Readonly<{
  params: { id: string; coinId: string };
}>;

export default function Page({ params }: PageProps) {
  return <PortfolioCoinPage portfolioId={params.id} coinId={params.coinId} />;
}
