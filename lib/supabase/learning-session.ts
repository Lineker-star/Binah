import { createClient } from './client';

export const SESSION_STATUSES = ['active', 'paused', 'completed', 'abandoned'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/** Row shape of `public.learning_sessions`. */
export interface LearningSession {
  id: string;
  learner_id: string;
  stage_id: string | null;
  title: string;
  topic: string | null;
  status: SessionStatus;
  skill_track_id: string | null;
  started_at: string;
  paused_at: string | null;
  resumed_at: string | null;
  ended_at: string | null;
  last_scene_id: string | null;
  last_scene_index: number;
  total_active_seconds: number;
  created_at: string;
  updated_at: string;
}

/**
 * Start a new session for the current learner. Multiple sessions may be
 * active/paused simultaneously — this never touches any other row.
 *
 * Returns `null` when there is no signed-in user (matches the rest of the
 * app: course generation must keep working for an anonymous visitor, so
 * callers treat a `null` return as "skip session tracking", not an error).
 */
export async function createLearningSession(input: {
  stageId: string;
  title: string;
  topic?: string;
  /** Set when this session was started from within a skill track (see
   *  `/skill-tracks`), so the track's aggregate progress can later be
   *  rolled up from its tagged sessions. `null` for ad-hoc generation. */
  skillTrackId?: string | null;
}): Promise<LearningSession | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('learning_sessions')
    .insert({
      learner_id: user.id,
      stage_id: input.stageId,
      title: input.title,
      topic: input.topic ?? null,
      skill_track_id: input.skillTrackId ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as LearningSession;
}

/** List the signed-in learner's own sessions, most recently updated first. */
export async function listLearnerSessions(): Promise<LearningSession[]> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('learning_sessions')
    .select('*')
    .eq('learner_id', user.id)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as LearningSession[];
}

/**
 * Find the learner's own not-yet-finished session for a given stage (most
 * recently updated, `active` or `paused`). Used to resolve "the session for
 * this classroom view" on load — for auto-marking completion and for the
 * scene-progress hook — without threading a session id through navigation.
 * Returns `null` for an anonymous visitor or a stage with no open session
 * (e.g. a locally-imported course that was never tracked).
 */
export async function findSessionForStage(stageId: string): Promise<LearningSession | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('learning_sessions')
    .select('*')
    .eq('learner_id', user.id)
    .eq('stage_id', stageId)
    .in('status', ['active', 'paused'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as LearningSession | null) ?? null;
}

export async function pauseSession(sessionId: string): Promise<LearningSession> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('learning_sessions')
    .update({ status: 'paused', paused_at: new Date().toISOString() })
    .eq('id', sessionId)
    .select('*')
    .single();
  if (error) throw error;
  return data as LearningSession;
}

/**
 * Resume a paused (or otherwise re-entered) session. Returns the updated row
 * so the caller can read `last_scene_id`/`last_scene_index` and restore the
 * learner to where they left off.
 */
export async function resumeSession(sessionId: string): Promise<LearningSession> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('learning_sessions')
    .update({ status: 'active', resumed_at: new Date().toISOString() })
    .eq('id', sessionId)
    .select('*')
    .single();
  if (error) throw error;
  return data as LearningSession;
}

/**
 * End a session.
 *
 * `completed` vs `abandoned`: `completed` means the learner actually
 * reached the end of the course (the caller passes `completed: true` only
 * from the classroom's own "course complete" signal — see
 * `isCourseComplete` in PlaybackChromeRoot). `abandoned` means the session
 * is being closed out any other way — an explicit "end early" action from
 * the Recent list, or a host-side cleanup — while the course was not yet
 * finished. The distinction is entirely about whether the *content* was
 * finished, not about how deliberate the action was: a learner who
 * intentionally quits a half-done course is still "abandoned", not
 * "completed", because the row should answer "did they finish this
 * course", not "did they mean to stop".
 */
export async function endSession(
  sessionId: string,
  outcome: { completed: boolean },
): Promise<LearningSession> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('learning_sessions')
    .update({
      status: outcome.completed ? 'completed' : 'abandoned',
      ended_at: new Date().toISOString(),
    })
    .eq('id', sessionId)
    .select('*')
    .single();
  if (error) throw error;
  return data as LearningSession;
}

/** Record where the learner currently is, for `resumeSession` to restore later. */
export async function updateSessionCursor(
  sessionId: string,
  cursor: { lastSceneId: string; lastSceneIndex: number },
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('learning_sessions')
    .update({ last_scene_id: cursor.lastSceneId, last_scene_index: cursor.lastSceneIndex })
    .eq('id', sessionId);
  if (error) throw error;
}
