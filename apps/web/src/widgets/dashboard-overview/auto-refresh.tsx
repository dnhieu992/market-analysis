'use client';

import { useRouter } from 'next/navigation';

import { usePoll } from '@web/shared/lib/use-poll';

type Props = Readonly<{
  intervalMs: number;
}>;

/**
 * Re-runs the overview's server component on an interval, which re-fetches everything the page
 * renders from the API — orders, holdings, realized PnL and the asset summary — and streams the
 * new props into the already-mounted client components. Renders nothing itself.
 *
 * `router.refresh()` is used rather than a fetch per widget because the numbers on this page come
 * from six endpoints that the server component already composes; re-doing that composition on the
 * client would duplicate it. Client state survives a refresh, so an open dialog stays open and
 * mid-typed input is not lost.
 */
export function AutoRefresh({ intervalMs }: Props) {
  const router = useRouter();

  usePoll(() => router.refresh(), intervalMs);

  return null;
}
