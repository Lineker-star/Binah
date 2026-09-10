import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * Server-side guard for `/textbook/[id]`: same shape as `/history`'s guard
 * — textbook ingestion is inherently tied to a signed-in learner_id, so an
 * unauthenticated visitor is bounced to sign in with a returnTo.
 */
export default async function TextbookLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/auth?returnTo=%2Ftextbook');

  return <div className="min-h-screen bg-background">{children}</div>;
}
