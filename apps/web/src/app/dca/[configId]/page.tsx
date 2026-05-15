import DcaDetailPage from '@web/_pages/dca-detail-page/dca-detail-page';

type Props = {
  params: { configId: string };
};

export default function Page({ params }: Props) {
  return <DcaDetailPage configId={params.configId} />;
}
