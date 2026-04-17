import PortfolioDetailPage from '@web/pages/portfolio-detail-page/portfolio-detail-page';

type PageProps = Readonly<{
  params: { id: string };
}>;

export default function Page({ params }: PageProps) {
  return <PortfolioDetailPage portfolioId={params.id} />;
}
