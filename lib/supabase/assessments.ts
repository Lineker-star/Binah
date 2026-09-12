import { createClient } from './client';

export type AssessmentType = 'quiz' | 'pbl' | 'continuous_assessment' | 'exam';

export interface RecordAssessmentInput {
  assessmentType: AssessmentType;
  sessionId?: string | null;
  sceneId?: string | null;
  /**
   * Set directly for an assessment not tied to any one lesson (Continuous
   * Assessment: session_id is null, chapter_id is this instead). The
   * regular per-lesson quiz path leaves this unset — the server derives it
   * from sessionId, same as it always has.
   */
  chapterId?: string | null;
  /**
   * Exam, module tier: the module this exam spans. The server resolves
   * course_id from this (module -> ingestion -> course), same shape as
   * chapterId above.
   */
  moduleId?: string | null;
  /**
   * Exam, book tier: set directly instead of moduleId when the source book
   * has no module layer (see needsModuleLayer in
   * lib/textbook/structure-plan.ts) — there's no module row to derive
   * course_id from, so the caller passes it straight through.
   */
  courseId?: string | null;
  score?: number | null;
  maxScore?: number | null;
  feedback?: string | null;
  strengths?: string[];
  areasToImprove?: string[];
  evaluatedBy: string;
}

/** One assessment row as read back for the learner's own growth charts
 *  (see components/settings/progress-growth-charts.tsx). assessment_type
 *  is a bare string, not the narrower write-side AssessmentType, since a
 *  read also sees 'course_final' — inserted via its own dedicated route
 *  (app/api/assessments/course-final/route.ts), never through the generic
 *  one this file's AssessmentType scopes. */
export interface AssessmentRecord {
  id: string;
  assessment_type: string;
  score: number | null;
  max_score: number | null;
  passed: boolean | null;
  attempt_number: number;
  created_at: string;
}

/**
 * The signed-in learner's own assessments, oldest first — the source data
 * for a score-over-time trend. A retake never overwrites the failed
 * attempt (see attempt_number — Tier R.4), so this naturally returns full
 * attempt history, not just the latest attempt per scope.
 */
export async function listOwnAssessments(): Promise<AssessmentRecord[]> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('assessments')
    .select('id, assessment_type, score, max_score, passed, attempt_number, created_at')
    .eq('learner_id', user.id)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as AssessmentRecord[];
}

/**
 * Record one assessment (quiz grading or PBL evaluation) and refresh the
 * learner's `learning_metrics`, via `POST /api/assessments`.
 *
 * The insert + recompute happen server-side under the service-role client
 * (see the route) — this is just the browser-side trigger. Skips silently
 * (no request at all) when there's no signed-in Supabase user, matching
 * every other piece of session/progress tracking in this app: recording is
 * best-effort and must never block or error the learner-facing flow that
 * triggered it.
 */
export async function recordAssessment(input: RecordAssessmentInput): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const res = await fetch('/api/assessments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`Failed to record assessment: ${res.status}`);
  }
}
