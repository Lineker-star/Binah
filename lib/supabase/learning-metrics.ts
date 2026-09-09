import { createClient } from './client';

/** Row shape of `public.learning_metrics`. */
export interface LearningMetrics {
  learner_id: string;
  total_sessions: number;
  sessions_completed: number;
  total_active_seconds: number;
  avg_assessment_score: number | null;
  current_streak_days: number;
  longest_streak_days: number;
  last_active_at: string | null;
  updated_at: string;
}

/**
 * Fetch the signed-in learner's own metrics row. Returns `null` for no
 * session, and also for a signed-in learner with no row yet — the row is
 * only created by `recompute_learning_metrics` (first assessment or a
 * session ending), so a brand-new account has none. Callers treat both the
 * same: an empty/zeroed progress view, not an error.
 */
export async function fetchOwnMetrics(): Promise<LearningMetrics | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('learning_metrics')
    .select('*')
    .eq('learner_id', user.id)
    .maybeSingle();
  if (error) throw error;
  return data as LearningMetrics | null;
}
