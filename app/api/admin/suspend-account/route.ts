/**
 * Admin-only: suspend or reactivate an account. Soft suspension, never a
 * delete — nothing about the account's sessions, assessments, or
 * certificates is touched.
 *
 * Real enforcement is Supabase Auth's own ban (auth.users.banned_until,
 * confirmed to exist against the live schema before building this), set
 * via the Admin API — requires the service-role client, since this is a
 * privileged Auth surface RLS doesn't gate at all. The existing global
 * middleware auth gate already calls supabase.auth.getUser() (not
 * getSession()) on every request, which round-trips to the Auth server and
 * rejects a banned user there — so suspension takes effect on the account's
 * very next request with zero changes to the middleware itself.
 *
 * profiles.suspended is a display mirror only, written separately through
 * the caller's own admin session (profiles_admin_all already grants this,
 * no service role needed for that half). Two writes, not a transaction —
 * the same accepted simplification changeUserRole itself already documents.
 */
import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireAdmin } from '@/lib/server/require-admin';
import { createLogger } from '@/lib/logger';

const log = createLogger('AdminSuspendAccount');

export async function POST(req: NextRequest) {
  const blocked = await requireAdmin();
  if (blocked) return blocked;

  try {
    const body = await req.json();
    const { learnerId, suspend } = body as { learnerId?: string; suspend?: boolean };
    if (!learnerId || typeof suspend !== 'boolean') {
      return apiError('INVALID_REQUEST', 400, 'Missing learnerId or suspend');
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return apiError('UNAUTHENTICATED', 401, 'Sign-in required');

    // An admin can't lock themselves out — the ban would take effect on
    // their own very next request, same as anyone else's.
    if (learnerId === user.id) {
      return apiError('INVALID_REQUEST', 400, 'Cannot suspend your own account');
    }

    const serviceRole = createServiceRoleClient();
    const { error: banError } = await serviceRole.auth.admin.updateUserById(learnerId, {
      ban_duration: suspend ? '876000h' : 'none',
    });
    if (banError) return apiError('INTERNAL_ERROR', 500, banError.message);

    const { error: profileError } = await supabase
      .from('profiles')
      .update({ suspended: suspend })
      .eq('id', learnerId);
    if (profileError) return apiError('INTERNAL_ERROR', 500, profileError.message);

    // Best-effort — the suspension itself already took effect even if this fails.
    const { error: auditError } = await supabase.from('admin_audit_log').insert({
      admin_id: user.id,
      action: suspend ? 'account_suspended' : 'account_reactivated',
      target_user_id: learnerId,
      details: {},
    });
    if (auditError) log.warn('Failed to record audit log entry:', auditError);

    return apiSuccess({ learnerId, suspended: suspend });
  } catch (err) {
    log.error('Failed to update suspension state:', err);
    return apiError('INTERNAL_ERROR', 500, err instanceof Error ? err.message : 'Unknown error');
  }
}
