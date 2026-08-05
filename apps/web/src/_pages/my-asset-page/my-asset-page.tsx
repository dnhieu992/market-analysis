import { createServerApiClient } from '@web/shared/auth/api-auth';
import type { AssetSummary } from '@web/shared/api/types';
import { MyAsset } from '@web/widgets/my-asset/my-asset';

/** Renders an empty page instead of a crash when the API is down. */
const EMPTY_SUMMARY: AssetSummary = {
  totalUsdt: 0,
  totalDepositedUsdt: 0,
  totalWithdrawnUsdt: 0,
  categories: [],
  transactions: [],
};

export default async function MyAssetPage() {
  const client = createServerApiClient();
  const summary = await client.fetchAssetSummary().catch(() => EMPTY_SUMMARY);

  return <MyAsset initialSummary={summary} />;
}
