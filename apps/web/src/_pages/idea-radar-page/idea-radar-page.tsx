import type { IdeaRadarOverview } from '@web/shared/api/types';
import { createServerApiClient } from '@web/shared/auth/api-auth';
import { IdeaRadarView } from '@web/widgets/idea-radar/idea-radar-view';

/** /idea-radar — weekly app ideas from store charts, 1–2★ reviews and Reddit / HN (Claude-scored). */
export default async function IdeaRadarPage() {
  const initial = await createServerApiClient()
    .fetchIdeaRadarOverview()
    .catch((): IdeaRadarOverview | null => null);
  return <IdeaRadarView initial={initial} />;
}
