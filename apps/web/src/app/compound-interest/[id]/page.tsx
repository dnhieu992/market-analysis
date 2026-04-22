import CompoundInterestDetailPage from '@web/pages/compound-interest-detail-page/compound-interest-detail-page';

type PageProps = Readonly<{
  params: { id: string };
}>;

export default function Page({ params }: PageProps) {
  return <CompoundInterestDetailPage portfolioId={params.id} />;
}
