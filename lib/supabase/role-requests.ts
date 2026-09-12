import { createClient } from './client';
import type { UserRole } from './profile';

export type RoleRequestStatus = 'pending' | 'approved' | 'rejected';

/** Row shape of `public.role_requests`. */
export interface RoleRequest {
  id: string;
  learner_id: string;
  requested_role: UserRole;
  status: RoleRequestStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

/**
 * The signed-in learner's own most recent role request, if any — drives
 * the Profile settings "Request Tutor/Parent Account" button (hidden while
 * a request is pending, showing the outcome once reviewed).
 */
export async function fetchOwnRoleRequest(): Promise<RoleRequest | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('role_requests')
    .select('*')
    .eq('learner_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as RoleRequest | null;
}

/**
 * Submit a request to become a parent/tutor account. Never auto-approves or
 * self-serves: role_requests_insert_own (RLS) independently enforces
 * `auth.uid() = learner_id`, `status = 'pending'`, and
 * `requested_role <> 'admin'` regardless of what's sent here, and there is
 * no UPDATE policy granting the requester any way to change status
 * afterward — only an admin, via approveRoleRequest/rejectRoleRequest in
 * lib/supabase/admin.ts, can ever transition it.
 */
export async function submitRoleRequest(): Promise<RoleRequest> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data, error } = await supabase
    .from('role_requests')
    .insert({ learner_id: user.id, requested_role: 'parent' })
    .select('*')
    .single();
  if (error) throw error;
  return data as RoleRequest;
}
