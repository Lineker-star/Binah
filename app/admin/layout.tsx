import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * Server-side gate for every `/admin/*` route: an unauthenticated visitor or
 * a signed-in non-admin gets a plain 404, not a redirect to a login/denied
 * page — so the route's existence is never revealed. This is in addition to
 * (not instead of) the database-level RLS policies (`*_admin_all`,
 * `audit_admin_only`) that already restrict what an admin session can read
 * or write; this layout only decides whether the shell renders at all.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: isAdmin, error } = await supabase.rpc('is_admin');
  if (error || !isAdmin) notFound();

  return <div className="min-h-screen bg-background">{children}</div>;
}
