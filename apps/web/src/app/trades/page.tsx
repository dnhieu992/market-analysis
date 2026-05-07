import TradesPage from '@web/pages/trades-page/trades-page';

type Props = {
  searchParams: Record<string, string | string[] | undefined>;
};

export default function Page({ searchParams }: Props) {
  return <TradesPage searchParams={searchParams} />;
}
