import { redirect } from 'next/navigation';

// Merged into /tracking-coins (bottom-DCA → x2). Kept as a redirect for old bookmarks.
export default function AccumulationRedirect() {
  redirect('/tracking-coins');
}
