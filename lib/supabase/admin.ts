import { nanoid } from 'nanoid';
import { createClient } from './client';
import type { Profile, UserRole } from './profile';
import type { LearningSession } from './learning-session';
import type { LearningMetrics } from './learning-metrics';
import type { AssessmentType } from './assessments';
import type { SkillTrack } from './skill-tracks';
import type { RoleRequest } from './role-requests';

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

/** A parent's linked child, as shown on the parent's admin detail page. */
export interface AdminLinkedChild {
  id: string;
  display_name: string | null;
  email: string | null;
}

/** The children currently linked to a parent account, for the admin detail view. */
export async function fetchLinkedChildrenForParent(parentId: string): Promise<AdminLinkedChild[]> {
  const supabase = createClient();
  const { data: links, error: linksError } = await supabase
    .from('parent_child_links')
    .select('child_id')
    .eq('parent_id', parentId);
  if (linksError) throw linksError;

  const childIds = (links ?? []).map((l) => l.child_id as string);
  if (childIds.length === 0) return [];

  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, display_name, email')
    .in('id', childIds);
  if (profilesError) throw profilesError;
  return (profiles ?? []) as AdminLinkedChild[];
}

/**
 * Link a parent account to a learner account by the learner's email —
 * the admin-manual half of the parent/child flow (the alternative,
 * child-side invite/approval flow is not built in this pass).
 *
 * Looks the child up by email rather than id because the admin panel's
 * learner list doesn't expose ids to click-to-select in a form input, and
 * email is the one human-enterable identifier every account has. Only a
 * `role: 'learner'` account can be linked as a child — linking two parents,
 * or a parent to an admin, isn't a case the schema or the parent dashboard
 * has any handling for.
 *
 * A pre-check for an existing identical link avoids duplicate rows:
 * `parent_child_links` has no unique constraint, and RLS only cares whether
 * a matching row exists (not how many), so a duplicate wouldn't be a
 * security issue — but it would render as a duplicate child card.
 */
export async function linkParentToChild(parentId: string, childEmail: string): Promise<void> {
  const supabase = createClient();
  const normalizedEmail = childEmail.trim().toLowerCase();
  if (!normalizedEmail) throw new Error('Enter the child’s email.');

  const { data: child, error: childError } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('email', normalizedEmail)
    .maybeSingle();
  if (childError) throw childError;
  if (!child) throw new Error('No account found with that email.');
  if (child.role !== 'learner') throw new Error('That account is not a learner account.');
  if (child.id === parentId) throw new Error('An account cannot be linked to itself.');

  const { data: existing, error: existingError } = await supabase
    .from('parent_child_links')
    .select('id')
    .eq('parent_id', parentId)
    .eq('child_id', child.id)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return;

  const { error: insertError } = await supabase
    .from('parent_child_links')
    .insert({ parent_id: parentId, child_id: child.id });
  if (insertError) throw insertError;
}

/** Editable fields for a skill track's create/edit form. */
export interface SkillTrackAdminInput {
  title: string;
  description: string;
  category: string;
  locale: string;
  isPublished: boolean;
}

/** `slug` is unique and NOT NULL but isn't a field the admin form exposes —
 *  derive one from the title and disambiguate with a short suffix rather
 *  than making the admin pick one. Nothing in the app looks tracks up by
 *  slug yet, so stability across edits isn't a concern. */
function slugifyTitle(title: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${base || 'track'}-${nanoid(6)}`;
}

/** Every skill track (published or not), for the admin management list. */
export async function fetchAllSkillTracksAdmin(): Promise<SkillTrack[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('skill_tracks')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as SkillTrack[];
}

export async function createSkillTrack(input: SkillTrackAdminInput): Promise<SkillTrack> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data, error } = await supabase
    .from('skill_tracks')
    .insert({
      slug: slugifyTitle(input.title),
      title: input.title,
      description: input.description || null,
      category: input.category || null,
      locale: input.locale,
      is_published: input.isPublished,
      created_by: user.id,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as SkillTrack;
}

export async function updateSkillTrack(
  id: string,
  input: SkillTrackAdminInput,
): Promise<SkillTrack> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('skill_tracks')
    .update({
      title: input.title,
      description: input.description || null,
      category: input.category || null,
      locale: input.locale,
      is_published: input.isPublished,
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as SkillTrack;
}

/** One pending role_requests row plus the requesting learner's basic profile info. */
export interface PendingRoleRequest extends RoleRequest {
  learner_display_name: string | null;
  learner_email: string | null;
}

/** Every pending role request, oldest first, for the admin review screen. */
export async function fetchPendingRoleRequests(): Promise<PendingRoleRequest[]> {
  const supabase = createClient();
  const { data: requests, error } = await supabase
    .from('role_requests')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw error;

  const rows = (requests ?? []) as RoleRequest[];
  if (rows.length === 0) return [];

  const learnerIds = [...new Set(rows.map((r) => r.learner_id))];
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, display_name, email')
    .in('id', learnerIds);
  if (profilesError) throw profilesError;

  const byId = new Map(
    (profiles ?? []).map((p) => [p.id as string, p as { display_name: string | null; email: string | null }]),
  );
  return rows.map((r) => ({
    ...r,
    learner_display_name: byId.get(r.learner_id)?.display_name ?? null,
    learner_email: byId.get(r.learner_id)?.email ?? null,
  }));
}

/**
 * Approve a role request: changes the requester's role (reusing
 * changeUserRole's existing write + admin_audit_log pattern) and marks the
 * request approved. Two plain writes, not a transaction — the same accepted
 * simplification changeUserRole itself already documents. No notification
 * system exists in this codebase (confirmed before building this) to push
 * to the requester; the role change alone is what they'll see reflected
 * next time they load the app (app/page.tsx's own auth effect already
 * re-reads profiles.role on every load and routes a parent to /parent).
 */
export async function approveRoleRequest(request: RoleRequest): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  await changeUserRole(request.learner_id, 'learner', request.requested_role);

  const { error } = await supabase
    .from('role_requests')
    .update({ status: 'approved', reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .eq('id', request.id);
  if (error) throw error;
}

/** Reject a role request — no role change, just marks it reviewed. */
export async function rejectRoleRequest(requestId: string): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { error } = await supabase
    .from('role_requests')
    .update({ status: 'rejected', reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .eq('id', requestId);
  if (error) throw error;
}
