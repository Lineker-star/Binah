import { createClient } from './client';
import type { Profile, UserRole } from './profile';
import type { LearningSession } from './learning-session';
import type { LearningMetrics } from './learning-metrics';
import type { AssessmentType } from './assessments';

/** One row in the admin learner list — a profile with its metrics rolled in. */
export interface AdminLearnerListItem {
  id: string;
  display_name: string | null;
  role: UserRole;
  created_at: string;
  last_active_at: string | null;
}

/** Row shape of `public.assessments`. */
export interface Assessment {
  id: string;
  session_id: string | null;
  learner_id: string;
  scene_id: string | null;
  assessment_type: AssessmentType;
  score: number | null;
  max_score: number | null;
  feedback: string | null;
  strengths: string[] | null;
  areas_to_improve: string[] | null;
  evaluated_by: string;
  created_at: string;
}

export interface LearnerDetail {
  profile: Profile;
  sessions: LearningSession[];
  assessments: Assessment[];
  metrics: LearningMetrics | null;
}

/**
 * List every learner account with the basics for an admin overview.
 *
 * Two plain reads merged in JS rather than a PostgREST embed — simpler to
 * reason about for a first pass, and both tables' `*_admin_all` RLS policies
 * (gated on `is_admin()`) already allow an admin to read every row of each,
 * no service-role client needed.
 */
export async function fetchAllLearnerProfiles(): Promise<AdminLearnerListItem[]> {
  const supabase = createClient();
  const [{ data: profiles, error: profilesError }, { data: metrics, error: metricsError }] =
    await Promise.all([
      supabase
        .from('profiles')
        .select('id, display_name, role, created_at')
        .order('created_at', { ascending: false }),
      supabase.from('learning_metrics').select('learner_id, last_active_at'),
    ]);
  if (profilesError) throw profilesError;
  if (metricsError) throw metricsError;

  const lastActiveById = new Map(
    (metrics ?? []).map((m) => [m.learner_id as string, m.last_active_at as string | null]),
  );
  return (profiles ?? []).map((p) => ({
    id: p.id,
    display_name: p.display_name,
    role: p.role,
    created_at: p.created_at,
    last_active_at: lastActiveById.get(p.id) ?? null,
  }));
}

/** One learner's profile + sessions + assessments + metrics, for the admin detail view. */
export async function fetchLearnerDetail(learnerId: string): Promise<LearnerDetail | null> {
  const supabase = createClient();
  const [
    { data: profile, error: profileError },
    { data: sessions, error: sessionsError },
    { data: assessments, error: assessmentsError },
    { data: metrics, error: metricsError },
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', learnerId).maybeSingle(),
    supabase
      .from('learning_sessions')
      .select('*')
      .eq('learner_id', learnerId)
      .order('updated_at', { ascending: false }),
    supabase
      .from('assessments')
      .select('*')
      .eq('learner_id', learnerId)
      .order('created_at', { ascending: false }),
    supabase.from('learning_metrics').select('*').eq('learner_id', learnerId).maybeSingle(),
  ]);
  if (profileError) throw profileError;
  if (sessionsError) throw sessionsError;
  if (assessmentsError) throw assessmentsError;
  if (metricsError) throw metricsError;
  if (!profile) return null;

  return {
    profile: profile as Profile,
    sessions: (sessions ?? []) as LearningSession[],
    assessments: (assessments ?? []) as Assessment[],
    metrics: (metrics as LearningMetrics | null) ?? null,
  };
}

/**
 * Change a user's role and record it in `admin_audit_log` in the same call.
 *
 * Both writes go through the normal (anon-key) client: `profiles_admin_all`
 * and `audit_admin_only` are both gated on `is_admin()`, so the acting
 * admin's own session already carries the authority — no service-role
 * client needed. The `profiles_guard_role` trigger (see the profile-screen
 * work) explicitly allows this for an actual admin actor; it only blocks a
 * non-admin changing their own role.
 *
 * Not a database transaction — for a low-frequency, admin-only action this
 * is an accepted, explicitly-noted simplification (see the summary): a
 * failure between the two writes leaves the role changed but unaudited,
 * which is visible/correctable, versus the audit row without the role
 * change actually happening (impossible, since the second write only runs
 * after the first succeeds).
 */
export async function changeUserRole(
  targetUserId: string,
  fromRole: UserRole,
  toRole: UserRole,
): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ role: toRole })
    .eq('id', targetUserId);
  if (updateError) throw updateError;

  const { error: auditError } = await supabase.from('admin_audit_log').insert({
    admin_id: user.id,
    action: 'role_change',
    target_user_id: targetUserId,
    details: { from: fromRole, to: toRole },
  });
  if (auditError) throw auditError;
}
