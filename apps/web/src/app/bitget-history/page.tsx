import { redirect } from 'next/navigation';

export default function BitgetHistoryRedirect() {
  redirect('/bitget?tab=history');
}
