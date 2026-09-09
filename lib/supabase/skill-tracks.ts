import { createClient } from './client';

/** Row shape of `public.skill_tracks`. */
export interface SkillTrack {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  category: string | null;
  locale: string;
  is_published: boolean;
  created_by: string | null;
  created_at: string;
}

/** Row shape of `public.skill_track_enrollments`. */
export interface SkillTrackEnrollment {
  id: string;
  learner_id: string;
  skill_track_id: string;
  status: string;
  progress_percent: number;
  enrolled_at: string;
  completed_at: string | null;
}

/**
 * Published skill tracks, for the learner-facing "Skill Tracks" browser.
 * `skill_tracks_read_published` has no `auth.uid()` check at all, so this
 * works for an anonymous visitor too (matching ad-hoc homepage generation) —
 * the explicit `is_published` filter here isn't strictly required by RLS
 * (an admin's session would also pass it via `is_admin()`), but keeps this
 * page showing only published tracks even when an admin is browsing it as
 * a learner would; unpublished drafts belong to the admin panel only.
 */
export async function fetchPublishedSkillTracks(): Promise<SkillTrack[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('skill_tracks')
    .select('*')
    .eq('is_published', true)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as SkillTrack[];
}

/** The signed-in learner's own enrollments, for marking which tracks are already joined. */
export async function fetchOwnEnrollments(): Promise<SkillTrackEnrollment[]> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('skill_track_enrollments')
    .select('*')
    .eq('learner_id', user.id);
  if (error) throw error;
  return (data ?? []) as SkillTrackEnrollment[];
}

/**
 * Enroll the signed-in learner in a track. A pre-check avoids a duplicate
 * enrollment row (no unique constraint on the pair, same reasoning as
 * `linkParentToChild`). Throws when there's no signed-in user — unlike
 * course generation or session tracking elsewhere in the app, enrolling is
 * the explicit action the learner is taking here, so the caller should show
 * this as a real failure (e.g. "sign in to enroll"), not silently no-op.
 */
export async function enrollInTrack(skillTrackId: string): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('not-signed-in');

  const { data: existing, error: existingError } = await supabase
    .from('skill_track_enrollments')
    .select('id')
    .eq('learner_id', user.id)
    .eq('skill_track_id', skillTrackId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return;

  const { error: insertError } = await supabase
    .from('skill_track_enrollments')
    .insert({ learner_id: user.id, skill_track_id: skillTrackId });
  if (insertError) throw insertError;
}
