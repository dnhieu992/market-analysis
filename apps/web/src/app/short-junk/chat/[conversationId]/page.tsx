import ShortJunkPage from '@web/_pages/short-junk-page/short-junk-page';

type PageProps = Readonly<{
  params: { conversationId: string };
}>;

export default function Page({ params }: PageProps) {
  return <ShortJunkPage conversationId={params.conversationId} />;
}
