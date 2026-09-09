import { createClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client — bypasses Row Level Security entirely.
 *
 * SERVER-ONLY: the runtime guard below makes any accidental client-bundle
 * invocation throw immediately, and the key itself is never `NEXT_PUBLIC_`-
 * prefixed, so it can't reach the browser even if this module were imported
 * from client code. Use this only where RLS genuinely can't express the
 * check (e.g. `recompute_learning_metrics` takes a bare `learner_id` with no
 * internal `auth.uid()` guard — the caller must enforce "only your own id"
 * itself) or where a route already re-derives the authenticated user and is
 * just avoiding a second round-trip through the anon-key client.
 */
export function createServiceRoleClient() {
  if (typeof window !== 'undefined') {
    throw new Error('createServiceRoleClient must never be called in the browser.');
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('Supabase service-role client requested but not configured.');
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
