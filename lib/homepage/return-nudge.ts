/**
 * "Welcome back" return-after-a-gap detection.
 *
 * Threshold: 3+ days since `learning_metrics.last_active_at`. Long enough
 * that it doesn't fire on an ordinary day-or-two gap (a busy weekday, a
 * skipped weekend), short enough to catch the learner while the material
 * is still fresh and before disengagement turns into churn — the standard
 * "nudge before they drift away" window for session-based learning tools
 * skews toward the proactive end of a few days to a week; 3 days is that
 * proactive end.
 *
 * Computed fresh from live data on each homepage load — there is no
 * stored "pending notification" row (in-app only, evaluated on next
 * visit, per spec). Dismissal is remembered per-browser (localStorage),
 * keyed to the `last_active_at` value that triggered it: dismissing hides
 * this specific return, but the next time the learner goes inactive for
 * another qualifying gap, `last_active_at` will have moved and a fresh
 * nudge is shown.
 */
import { fetchOwnMetrics } from '@/lib/supabase/learning-metrics';
import { listLearnerSessions, type LearningSession } from '@/lib/supabase/learning-session';
import { listActiveRecommendations } from '@/lib/supabase/recommendations';

const GAP_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;
const DISMISS_KEY = 'returnNudgeDismissedFor';

export type ReturnNudge =
  | { kind: 'resume_session'; lastActiveAt: string; session: LearningSession }
  | { kind: 'weak_area'; lastActiveAt: string; recommendationId: string; focusArea: string };

function readDismissedFor(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

/** Remember that the learner dismissed the nudge for this `last_active_at`. */
export function dismissReturnNudge(lastActiveAt: string): void {
  try {
    localStorage.setItem(DISMISS_KEY, lastActiveAt);
  } catch {
    /* localStorage unavailable — the nudge may reappear next visit, not fatal */
  }
}

/**
 * Compute this visit's return nudge, or `null` when no gap qualifies, it
 * was already dismissed, or there's nothing concrete to suggest.
 *
 * Prefers resuming a known in-progress session (active or paused — after
 * a multi-day gap an "active" session is functionally paused too, same
 * bucketing as the homepage's Recent list) over a weak-area suggestion,
 * since picking up exactly where they left off is more concrete and
 * actionable than a general review prompt.
 */
export async function computeReturnNudge(): Promise<ReturnNudge | null> {
  const metrics = await fetchOwnMetrics();
  if (!metrics?.last_active_at) return null;

  const gapMs = Date.now() - new Date(metrics.last_active_at).getTime();
  if (gapMs < GAP_THRESHOLD_MS) return null;
  if (readDismissedFor() === metrics.last_active_at) return null;

  const sessions = await listLearnerSessions();
  const inProgress = sessions
    .filter((s) => s.status === 'active' || s.status === 'paused')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  if (inProgress) {
    return { kind: 'resume_session', lastActiveAt: metrics.last_active_at, session: inProgress };
  }

  const recommendations = await listActiveRecommendations();
  const recommendation = recommendations[0];
  if (recommendation) {
    const focusArea = recommendation.suggested_focus_areas?.[0] ?? recommendation.recommendation_text;
    return {
      kind: 'weak_area',
      lastActiveAt: metrics.last_active_at,
      recommendationId: recommendation.id,
      focusArea,
    };
  }

  return null;
}
