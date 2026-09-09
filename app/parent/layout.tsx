import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * Server-side guard for `/parent`: unlike `/admin`, this route's existence
 * isn't sensitive, so an unauthenticated or wrong-role visitor gets a plain
 * redirect (to sign in, or back to the learner home) rather than a 404.
 */
export default async function ParentLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/auth');

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (profile?.role !== 'parent') redirect('/');

  return <div className="min-h-screen bg-background">{children}</div>;
}
