import CompoundInterestCoinPage from '@web/pages/compound-interest-coin-page/compound-interest-coin-page';

type PageProps = Readonly<{
  params: { id: string; coinId: string };
}>;

export default function Page({ params }: PageProps) {
  return <CompoundInterestCoinPage portfolioId={params.id} coinId={params.coinId} />;
}
