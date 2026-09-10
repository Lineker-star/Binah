import { createClient } from './client';

/** Row shape of `public.recommendations`. */
export interface Recommendation {
  id: string;
  learner_id: string;
  course_id: string | null;
  source_assessment_id: string | null;
  recommendation_text: string;
  suggested_focus_areas: string[] | null;
  dismissed: boolean;
  created_at: string;
}

/** List the signed-in learner's own, non-dismissed recommendations, most recent first. */
export async function listActiveRecommendations(): Promise<Recommendation[]> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('recommendations')
    .select('*')
    .eq('learner_id', user.id)
    .eq('dismissed', false)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Recommendation[];
}

/** Dismiss a recommendation — hides it from future listings without deleting the row. */
export async function dismissRecommendation(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('recommendations').update({ dismissed: true }).eq('id', id);
  if (error) throw error;
}
