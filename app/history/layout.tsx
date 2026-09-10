import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * Server-side guard for `/history`: same shape as `/parent`'s guard — an
 * unauthenticated visitor gets bounced to sign in (with a returnTo so they
 * land back here) rather than a 404, since the route's existence isn't
 * sensitive.
 */
export default async function HistoryLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/auth?returnTo=%2Fhistory');

  return <div className="min-h-screen bg-background">{children}</div>;
}
