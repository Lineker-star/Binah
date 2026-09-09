import { createClient } from './client';
import type { LearningSession } from './learning-session';
import type { LearningMetrics } from './learning-metrics';

/** One linked child, for the parent dashboard — profile + metrics + recent sessions. */
export interface LinkedChild {
  id: string;
  display_name: string | null;
  metrics: LearningMetrics | null;
  recentSessions: LearningSession[];
}

const RECENT_SESSIONS_PER_CHILD = 5;

/**
 * The signed-in parent's linked children, each with their metrics and a
 * handful of recent sessions — read-only, for the parent dashboard.
 * `sessions_parent_read` / `metrics_parent_read` / `profiles_parent_read`
 * all gate on the same `parent_child_links` row, so once a link exists this
 * just reads through it; no write path is offered anywhere in this module.
 */
export async function fetchLinkedChildren(): Promise<LinkedChild[]> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: links, error: linksError } = await supabase
    .from('parent_child_links')
    .select('child_id')
    .eq('parent_id', user.id);
  if (linksError) throw linksError;

  const childIds = (links ?? []).map((l) => l.child_id as string);
  if (childIds.length === 0) return [];

  const [
    { data: profiles, error: profilesError },
    { data: metrics, error: metricsError },
    { data: sessions, error: sessionsError },
  ] = await Promise.all([
    supabase.from('profiles').select('id, display_name').in('id', childIds),
    supabase.from('learning_metrics').select('*').in('learner_id', childIds),
    supabase
      .from('learning_sessions')
      .select('*')
      .in('learner_id', childIds)
      .order('updated_at', { ascending: false }),
  ]);
  if (profilesError) throw profilesError;
  if (metricsError) throw metricsError;
  if (sessionsError) throw sessionsError;

  const metricsById = new Map((metrics ?? []).map((m) => [m.learner_id as string, m as LearningMetrics]));
  const sessionsByChild = new Map<string, LearningSession[]>();
  for (const session of (sessions ?? []) as LearningSession[]) {
    const list = sessionsByChild.get(session.learner_id) ?? [];
    if (list.length < RECENT_SESSIONS_PER_CHILD) list.push(session);
    sessionsByChild.set(session.learner_id, list);
  }

  return (profiles ?? []).map((p) => ({
    id: p.id,
    display_name: p.display_name,
    metrics: metricsById.get(p.id) ?? null,
    recentSessions: sessionsByChild.get(p.id) ?? [],
  }));
}
