import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { apiError, type ApiErrorBody } from './api-response';
import type { NextResponse } from 'next/server';

/**
 * Guard for admin-only routes (e.g. saving a learner-wide system_settings
 * default). Mirrors app/admin/layout.tsx's own check — same is_admin() RPC —
 * so a route and the page that links to it agree on who's allowed.
 *
 * Returns a NextResponse to return immediately when the request must be
 * blocked, or null when it may proceed.
 */
export async function requireAdmin(): Promise<NextResponse<ApiErrorBody> | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return apiError('UNAUTHENTICATED', 401, 'Sign-in required');
  }

  const { data: isAdmin, error } = await supabase.rpc('is_admin');
  if (error || !isAdmin) {
    return apiError('ROLE_NOT_ALLOWED', 403, 'Admin access required');
  }

  return null;
}
