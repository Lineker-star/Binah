/**
 * "The learner's open Supabase session for this stage, if any" — carried
 * beside the stage store rather than inside it, same idiom as
 * `stage-ownership-signal.ts`. Resolved once per classroom load
 * (`findSessionForStage`) and read by whatever needs the session id for
 * this view: auto-completion, scene-progress tracking, pause/resume.
 *
 * A plain per-stage last-write record, like its ownership counterpart — this
 * classroom has no destructive visitor path that needs load-ordering.
 */

import type { LearningSession } from '@/lib/supabase/learning-session';

const learningSessions = new Map<string, LearningSession | null>();

/**
 * Record the current open session for `stageId` — after the initial load's
 * resolution, and again after any pause/resume/end call changes the row.
 */
export function noteLearningSession(stageId: string, session: LearningSession | null): void {
  learningSessions.set(stageId, session);
}

/** The most recently resolved open session for `stageId`, or `null` (none / anonymous). */
export function getLearningSession(stageId: string): LearningSession | null {
  return learningSessions.get(stageId) ?? null;
}

/** Test hook: forget every recorded session. */
export function resetLearningSessionSignals(): void {
  learningSessions.clear();
}
