import { redirect } from 'next/navigation';

/** Merged into the P&L hub — kept so old links/bookmarks land on the right tab. */
export default function Page() {
  redirect('/pnl-calendar?tab=portfolio');
}
